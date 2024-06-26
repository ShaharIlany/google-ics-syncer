import parse from "./parseICS";
import type { CalendarEvent } from "./types";
import { google, calendar_v3 } from "googleapis"

const oauth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET
);

oauth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });

const parseDate = (dateString: string) => {
    const date = `${dateString.slice(0, 4)}-${dateString.slice(4, 6)}-${dateString.slice(6, 8)}`
    const time = dateString.length > 8 ? `${dateString.slice(8, 11)}:${dateString.slice(11, 13)}:${dateString.slice(13, 15)}` : ""
    return `${date}${time}`
}

const getEventStartEnd = (event: CalendarEvent): { start: calendar_v3.Schema$EventDateTime, end: calendar_v3.Schema$EventDateTime } => {
    if (event["x-microsoft-cdo-alldayevent"]) {
        return {
            start: { date: parseDate(event.dtstart.split(":")[1]) },
            end: { date: parseDate(event.dtend.split(":")[1]) }
        }
    } else {
        return {
            start: {
                dateTime: parseDate(event.dtstart.split(":")[1]),
                timeZone: "Asia/Jerusalem"
            },
            end: {
                dateTime: parseDate(event.dtend.split(":")[1]),
                timeZone: "Asia/Jerusalem"
            }
        }
    }
}

try {
    const res = await fetch(process.env.ICS_URL!)
    const data = await res.text()
    const calendars = parse(data)
    for (const calendar of calendars) {
        const gCal = google.calendar({ version: 'v3', auth: oauth2Client });
        let googleEvents = (await gCal.events.list({
            calendarId: process.env.CALENDAR_ID,
            timeMin: new Date().toISOString(),
            maxResults: 1000,
            singleEvents: true,
            orderBy: 'startTime'
        })).data.items ?? []

        for (const event of calendar.events) {
            // const summary = reserved.reduce((value, reservedPhrase) => value.replaceAll(reservedPhrase[0], reservedPhrase[1]), event.summary).replaceAll(/[ ]+/g, " ")
            const summary = event.summary.replaceAll(/[ ]+/g, " ")
            console.log(`[${summary}]: Starting process`)
            if (summary.startsWith("canceled")) {
                console.log(`[${summary}]: Event is canceled, skipping`)
                continue
            }
            const { start, end } = getEventStartEnd(event)

            console.log(`[${summary}]: Looking for matching event on google calendar`)
            const matchingGoogleEvent = googleEvents.find(googleEvent => {
                if (!googleEvent.end) {
                    return false
                }
                if (googleEvent.summary !== summary) {
                    return false
                }

                if (!!googleEvent.end.date !== !!end.date) {
                    return false
                }

                if (!!googleEvent.end.dateTime !== !!end.dateTime) {
                    return false
                }

                if (!!googleEvent.end.timeZone !== !!end.timeZone) {
                    return false
                }

                if (googleEvent.end.date && end.date) {
                    if (googleEvent.end.date !== end.date) {
                        return false
                    }
                }

                if (googleEvent.end.dateTime && end.dateTime) {
                    if (!googleEvent.end.dateTime.startsWith(end.dateTime)) {
                        return false
                    }
                }

                if (googleEvent.end.timeZone && end.timeZone) {
                    if (googleEvent.end.timeZone !== end.timeZone) {
                        return false
                    }
                }
                return true
            })

            if (matchingGoogleEvent) {
                console.log(`[${summary}]: Found matching event. Skipping`)
                googleEvents = googleEvents.filter(googleEvent => googleEvent.id !== matchingGoogleEvent.id)
            } else {
                console.log(`[${summary}]: !!!`)
                console.log(`[${summary}]: !!!`)
                console.log(`[${summary}]: Inserting event into google calendar`)
                console.log(`[${summary}]: !!!`)
                console.log(`[${summary}]: !!!`)

                await gCal.events.insert({
                    calendarId: process.env.CALENDAR_ID,
                    requestBody: {
                        summary,
                        start, end
                    }
                })
            }
            console.log(`[${summary}]: Done`)

        }

        console.log(`Finished parsing for this calendar. Events left: ${googleEvents.length}`)
        if (googleEvents.length > 0) {
            console.log("Deleting left google events (probably canceled)")
            for (const event of googleEvents) {
                console.log(`[${event.summary}] Deleting`)
                if (!event.id) {
                    console.log(`[${event.summary}] Can't delete event, no ID available`)
                    continue
                }
                await gCal.events.delete({
                    calendarId: process.env.CALENDAR_ID,
                    eventId: event.id
                })
                console.log(`[${event.summary}] Deleted`)
            }
        }
    }
} catch (e) {
    console.log("Error:", e)
}