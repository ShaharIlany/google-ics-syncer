import { updateAboutEvents } from "./notifications";
import parse from "./parseICS";
import type { CalendarEvent, MinifiedEvent, ReservedWord } from "./types";
import { google, calendar_v3 } from "googleapis"

const oauth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET
);

const reservedWords: ReservedWord[] = JSON.parse(process.env.RESERVED_WORDS ?? "[]")

oauth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });

const parseDate = (dateString: string, withTime: boolean = true) => {
    const date = `${dateString.slice(0, 4)}-${dateString.slice(4, 6)}-${dateString.slice(6, 8)}`
    const time = withTime && dateString.length > 8 ? `${dateString.slice(8, 11)}:${dateString.slice(11, 13)}:${dateString.slice(13, 15)}` : ""
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
    const addedEvents: MinifiedEvent[] = []
    const deletedEvents: MinifiedEvent[] = []
    const rescheduledEvents: MinifiedEvent[] = []
    const res = await fetch(process.env.ICS_URL!)
    const data = await res.text()
    const calendars = parse(data)
    for (const calendar of calendars) {
        console.log("Starting to process calendar")
        if (calendar.events.length === 0) {
            console.log("No events on this calendar. Skipping")
            continue
        }

        const earliestDate = new Date(parseDate(calendar.events[0].dtstart.split(":")[1], false)).toISOString()

        console.log(`Starting from ${earliestDate}`)

        const gCal = google.calendar({ version: 'v3', auth: oauth2Client });
        let googleEvents = (await gCal.events.list({
            calendarId: process.env.CALENDAR_ID,
            timeMin: earliestDate,
            maxResults: 1000,
            singleEvents: true,
            orderBy: 'startTime'
        })).data.items ?? []

        for (const event of calendar.events) {
            const uidForLogs = event.uid.substring(event.uid.length - 5)
            console.log(`<${uidForLogs}>: Starting process`)
            const summary = reservedWords.reduce((value, reservedPhrase) => value.replaceAll(reservedPhrase.search, reservedPhrase.replace), event.summary).replaceAll(/[ ]+/g, " ")
            const location = event.location.length > 1 ? event.location : undefined
            if (summary.startsWith("canceled")) {
                console.log(`<${uidForLogs}>: Event is canceled, skipping`)
                continue
            }
            const { start, end } = getEventStartEnd(event)

            if (start.dateTime && end.dateTime) {
                if (+(new Date(end.dateTime)) - +(new Date(start.dateTime)) === 0) {
                    console.log(`<${uidForLogs}>: Event is less than 1 minute long, skipping`)
                    continue
                }
            }
            console.log(`<${uidForLogs}>: Looking for matching event on google calendar`)
            const matchingGoogleEvent = googleEvents.find(googleEvent => {
                if (!googleEvent.end) {
                    return false
                }
                if (googleEvent.summary !== summary) {
                    return false
                }
                if (googleEvent.location !== location) {
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
                console.log(`<${uidForLogs}>: Found matching event. Skipping`)
                googleEvents = googleEvents.filter(googleEvent => googleEvent.id !== matchingGoogleEvent.id)
            } else {
                console.log(`<${uidForLogs}>: Inserting event into google calendar`)

                const newEvent = await gCal.events.insert({
                    calendarId: process.env.CALENDAR_ID,
                    requestBody: {
                        summary,
                        location,
                        start, end
                    }
                })
                addedEvents.push({ summary, start, end, location, googleEvent: newEvent.data })
            }
            console.log(`<${uidForLogs}>: Done`)

        }

        console.log(`Finished parsing for this calendar. Events left: ${googleEvents.length}`)
        if (googleEvents.length > 0) {
            console.log("Deleting left google events")
            for (const event of googleEvents) {
                const uidForLogs = (event.id ?? "").substring(0, 5)

                console.log(`<${uidForLogs}> Checking for matching events that currently added`)
                const rescheduledEvent = addedEvents.find(e => e.summary === event.summary)

                if (rescheduledEvent && rescheduledEvent.googleEvent.id) {
                    console.log(`<${uidForLogs}> This event is rescheduled.`)
                    console.log(`<${uidForLogs}> Updating the current event with the old properties`)

                    const { start, end } = rescheduledEvent.googleEvent
                    const { start: _, end: __, ...newEvent } = event

                    await gCal.events.update({
                        calendarId: process.env.CALENDAR_ID,
                        eventId: rescheduledEvent.googleEvent.id,
                        requestBody: {
                            start,
                            end,
                            ...newEvent
                        }
                    })

                    console.log(`<${uidForLogs}> Ok`)

                    console.log(`<${uidForLogs}> Adding event to rescheduled event list`)
                    rescheduledEvents.push(rescheduledEvent);

                    console.log(`<${uidForLogs}> Removing event from added event list`)
                    addedEvents.splice(addedEvents.findIndex((i) => i.googleEvent.id === rescheduledEvent.googleEvent.id), 1)


                } else {
                    console.log(`<${uidForLogs}> This event is probably canceled`)
                }

                console.log(`<${uidForLogs}> Deleting Old Event`)
                if (!event.id) {
                    console.log(`<${uidForLogs}> Can't delete event, no ID available`)
                    continue
                }
                await gCal.events.delete({
                    calendarId: process.env.CALENDAR_ID,
                    eventId: event.id
                })
                console.log(`<${uidForLogs}> Deleted`)
                if (!rescheduledEvent) {
                    console.log(`<${uidForLogs}> Adding event to deleted event list because it was not rescheduled`)
                    deletedEvents.push({ googleEvent: event, summary: event.summary ?? "- No Title -", start: event.start, end: event.end, location: event.location ?? undefined })
                }
                console.log(`<${uidForLogs}> Done`)
            }
        }
    }



    if (deletedEvents.length > 0 || addedEvents.length > 0 || rescheduledEvents.length > 0) {
        console.log(`Sending notification about events update`)
        await updateAboutEvents(addedEvents, deletedEvents, rescheduledEvents)
        console.log(`Notification sent`)
    }
    console.log(`Summary | Added Events: ${addedEvents.length}, Deleted Events: ${deletedEvents.length}, Rescheduled Events: ${rescheduledEvents.length}`)
} catch (e) {
    console.log("Error:", e)
}