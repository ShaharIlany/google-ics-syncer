import { addMilliseconds, format, max, parseISO } from "date-fns";
import { updateAboutEvents } from "./notifications";
import { type OutlookEvent, type MinifiedEvent, type ReservedWord, OutlookEventZod } from "./types";
import { google, calendar_v3 } from "googleapis"
import { getTimezoneOffset } from "date-fns-tz";

const oauth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET
);

const reservedWords: ReservedWord[] = JSON.parse(process.env.RESERVED_WORDS ?? "[]")

oauth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });

const asiaJerusalem = (date: Date) => addMilliseconds(date, getTimezoneOffset("Asia/Jerusalem"))

const getEventStartEnd = (event: OutlookEvent): { start: calendar_v3.Schema$EventDateTime, end: calendar_v3.Schema$EventDateTime } => {
    if (event.isAllDay) {
        return {
            start: { date: format(asiaJerusalem(event.start), "yyyy-MM-dd") },
            end: { date: format(asiaJerusalem(event.end), "yyyy-MM-dd") }
        }
    } else {
        return {
            start: {
                dateTime: format(asiaJerusalem(event.start), "yyyy-MM-dd'T'HH:mm:ssXXX"),
                timeZone: "Asia/Jerusalem"
            },
            end: {
                dateTime: format(asiaJerusalem(event.end), "yyyy-MM-dd'T'HH:mm:ssXXX"),
                timeZone: "Asia/Jerusalem"
            }
        }
    }
}

export const execute = async () => {
    try {
        const gDrive = google.drive({ version: "v3", auth: oauth2Client })

        const root = await gDrive.files.get({ fileId: "root" })
        if (!root.data.id) {
            console.log("Root drive not found")
        }

        const { data: { files: ***REMOVED***Directory } } = await gDrive.files.list({ pageSize: 10, fields: "files(id,name,parents)", q: `mimeType = 'application/vnd.google-apps.folder' and '${root.data.id}' in parents and name = '***REMOVED***'` })
        const ***REMOVED***DirectoryId = ***REMOVED***Directory?.[0].id
        if (!***REMOVED***DirectoryId) {
            console.log("***REMOVED***ectory not found.")
            return
        }

        const { data: { files: dataFile } } = await gDrive.files.list({ pageSize: 10, fields: "files(id,name,parents)", q: `'${***REMOVED***DirectoryId}' in parents and name = 'data.json'` })
        const dataFileId = dataFile?.[0].id
        if (!dataFileId) {
            console.log("***REMOVED***/data.json not found.")
            return
        }


        const { data } = await gDrive.files.get({ fileId: dataFileId, alt: "media", })
        const outlookEvents = OutlookEventZod.array().parse(data)

        console.log(`Downloaded ${outlookEvents.length} events. Starting`)

        const addedEvents: MinifiedEvent[] = []
        const deletedEvents: MinifiedEvent[] = []
        const rescheduledEvents: MinifiedEvent[] = []
        if (outlookEvents.length === 0) {
            return
        }

        const dateSorted = outlookEvents.toSorted((a, b) => +a.start - +b.start)
        const earliestDate = dateSorted[0].start

        console.log(earliestDate)
        console.log(max([earliestDate, new Date()]).toISOString())

        const gCal = google.calendar({ version: 'v3', auth: oauth2Client });
        let googleEvents = (await gCal.events.list({
            calendarId: process.env.CALENDAR_ID,
            timeMin: asiaJerusalem(earliestDate).toISOString(),
            maxResults: 1000,
            singleEvents: true,
            orderBy: 'startTime'
        })).data.items ?? []

        for (const event of outlookEvents) {
            console.log(``)
            console.log(`Starting to read new event`)
            const uidForLogs = event.id.substring(event.id.length - 10)

            const subject = reservedWords.reduce((value, reservedPhrase) => value.replaceAll(reservedPhrase.search, reservedPhrase.replace), event.subject).replaceAll(/[ ]+/g, " ")
            const location = event.location.length > 1 ? event.location : undefined
            if (subject.startsWith("canceled")) {
                console.log(`<${uidForLogs}>: Event is canceled, skipping`)
                continue;
            }

            if (+(new Date(event.end)) - +(new Date(event.start)) === 0) {
                console.log(`<${uidForLogs}>: Event is less than 1 minute long, skipping`)
                continue;
            }

            console.log(`<${uidForLogs}>: Looking for matching event on google calendar`)
            const matchingGoogleEvent = googleEvents.find(googleEvent => {

                if (!googleEvent.end) {
                    return false
                }

                // If the subjects are different then those are not the same events
                if (googleEvent.summary !== subject) {
                    return false
                }

                // If the locations are not the same then those are not the same events
                if (googleEvent.location !== location) {
                    return false
                }

                // If one of the events is all day and the second is not, then those are not the same events
                if (event.isAllDay !== !!(googleEvent.end.date)) {
                    return false
                }

                // If they are all day events but the end dates are different then those are not the same events
                if (event.isAllDay && googleEvent.end.date !== format(asiaJerusalem(event.end), "yyyy-MM-dd")) {
                    return false
                }

                if (!event.isAllDay) {
                    console.log(format(asiaJerusalem(parseISO(googleEvent.end.dateTime ?? "")), "yyyy-MM-dd'T'HH:mm:ssXXX"), format(asiaJerusalem(event.end), "yyyy-MM-dd'T'HH:mm:ssXXX"), format(asiaJerusalem(parseISO(googleEvent.end.dateTime ?? "")), "yyyy-MM-dd'T'HH:mm:ssXXX") === format(asiaJerusalem(event.end), "yyyy-MM-dd'T'HH:mm:ssXXX"))
                }

                // If they are not all day events but the end dates are different then those are not the same events
                if (!event.isAllDay && format(parseISO(googleEvent.end.dateTime ?? ""), "yyyy-MM-dd'T'HH:mm:ssXXX") !== format(asiaJerusalem(event.end), "yyyy-MM-dd'T'HH:mm:ssXXX")) {
                    console.log("No")
                    return false
                }
                console.log("Yes")

                return true
            })

            if (matchingGoogleEvent) {
                console.log(`<${uidForLogs}>: Found matching event. Skipping`)
                googleEvents = googleEvents.filter(googleEvent => googleEvent.id !== matchingGoogleEvent.id)
            } else {
                console.log(`<${uidForLogs}>: Inserting event into google calendar`)
                const { start, end } = getEventStartEnd(event)
                // const newEvent = await gCal.events.insert({
                //     calendarId: process.env.CALENDAR_ID,
                //     requestBody: {
                //         summary: subject,
                //         location,
                //         start, end
                //     }
                // })
                addedEvents.push({ summary: subject, start, end, location, googleEvent: {} })
            }
            console.log(`<${uidForLogs}>: Done`)

        }
        console.log(addedEvents.length)
        console.log(`Finished parsing for this calendar. Events left: ${googleEvents.length}`)
        throw Error("Not implemented")

        if (googleEvents.length > 0) {
            console.log("Deleting left google events")
            for (const event of googleEvents) {
                const { id, start, end, location, summary } = event
                if (!id || !start || !end) {
                    console.log("Event has no ID, start or end, skipping")
                    continue
                }
                const uidForLogs = id.substring(0, 5)

                console.log(`<${uidForLogs}> Checking for matching events that currently added`)
                const rescheduledEvent = addedEvents.find(e => e.summary === summary)

                if (rescheduledEvent && rescheduledEvent.googleEvent.id) {
                    console.log(`<${uidForLogs}> This event is rescheduled.`)
                    console.log(`<${uidForLogs}> Updating the current event with the old properties`)
                    const { start: _, end: __, ...oldProperties } = event
                    await gCal.events.update({
                        calendarId: process.env.CALENDAR_ID,
                        eventId: rescheduledEvent.googleEvent.id,
                        requestBody: {
                            start: rescheduledEvent.googleEvent.start,
                            end: rescheduledEvent.googleEvent.end,
                            ...oldProperties
                        }
                    })
                    rescheduledEvents.push({ summary: summary ?? "", start, end, location: location ?? "", googleEvent: event, oldEnd: rescheduledEvent.end, oldStart: rescheduledEvent.start })
                    console.log(`<${uidForLogs}> Removing event from added event list`)
                    addedEvents.splice(addedEvents.findIndex((i) => i.googleEvent.id === rescheduledEvent.googleEvent.id), 1)
                } else {
                    console.log(`<${uidForLogs}> Nothing found, probably deleted`)
                    deletedEvents.push({ summary: summary ?? "", start, end, location: location ?? "", googleEvent: event })
                }
                await gCal.events.delete({
                    calendarId: process.env.CALENDAR_ID,
                    eventId: id
                })
            }
        }

        if (deletedEvents.length > 0 || addedEvents.length > 0 || rescheduledEvents.length > 0) {
            console.log(`Sending notification about events update`)
            // await updateAboutEvents(addedEvents, deletedEvents, rescheduledEvents)
            console.log(`Notification sent`)
        }
        console.log(`Summary | Added Events: ${addedEvents.length}, Deleted Events: ${deletedEvents.length}, Rescheduled Events: ${rescheduledEvents.length}`)
    } catch (e) {
        console.log("Error:", e)
    }
}

await execute()