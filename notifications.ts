import { format, subDays } from "date-fns"
import type { MinifiedEvent } from "./types"
import type { calendar_v3 } from "googleapis"

const sendNotification = async (title: string, tags: string[], body: string, clickDate: Date) => {
    await fetch(`https://ntfy.sh/${process.env.NTFY_TOPIC_ID}`, {
        method: 'POST',
        headers: {
            'Title': title,
            'Click': `https://calendar.google.com/calendar/u/0/r/day/${format(clickDate, "yyyy/M/d")}`,
            'Tags': tags.join(",")
        },
        body,
    })
}


const formatDateString = (start: calendar_v3.Schema$EventDateTime, end: calendar_v3.Schema$EventDateTime) => {
    if (!start || !end) {
        return ""
    }

    if (start.date && end.date) {
        if (start.date === end.date) {
            // dd/MM/yyyy
            return format(new Date(end.date), "dd/MM/yyyy")
        } else {
            // dd/MM/yyyy - dd/MM/yyyy
            return `${format(new Date(start.date), "dd/MM/yyyy")} - ${format(subDays(new Date(end.date), 1), "dd/MM/yyyy")}`
        }
    }

    if (start.dateTime && end.dateTime) {
        const iStart = new Date(start.dateTime)
        const iEnd = new Date(end.dateTime)
        if (format(iStart, "dd/MM/yyyy") === format(iEnd, "dd/MM/yyyy")) {
            // dd/MM/yyyy HH:mm - HH:mm
            return `${format(iStart, "dd/MM/yyyy HH:mm")} - ${format(iEnd, "HH:mm")}`
        } else {
            // dd/MM/yyyy HH:mm - dd/MM/yyyy HH:mm
            return `${format(iStart, "dd/MM/yyyy HH:mm")} - ${format(iEnd, "dd/MM/yyyy HH:mm")}`
        }
    }

    return ""
}

export const updateAboutEvents = async (addedEvents: MinifiedEvent[], deletedEvents: MinifiedEvent[], rescheduledEvents: MinifiedEvent[]) => {
    for (const event of addedEvents) {
        if (event.start && event.end) {
            const formattedDate = formatDateString(event.start, event.end)
            const startTime = new Date(event.start?.date ?? event.start?.dateTime ?? "")
            await sendNotification("New Event", ["spiral_calendar"], `${event.summary}${formattedDate ? "\n🕑 " + formattedDate : ""}${event.location ? "\n📌 " + event.location : ""}`, startTime)
        }
    }

    for (const event of deletedEvents) {
        if (event.start && event.end) {
            const formattedDate = formatDateString(event.start, event.end)
            const startTime = new Date(event.start?.date ?? event.start?.dateTime ?? "")
            await sendNotification("Canceled Event", ["wastebasket"], `${event.summary}${formattedDate ? "\n🕑 " + formattedDate : ""}${event.location ? "\n📌 " + event.location : ""}`, startTime)
        }
    }

    for (const event of rescheduledEvents) {
        if (event.start && event.end && event.oldStart && event.oldEnd) {
            const formattedDate = formatDateString(event.start, event.end)
            const formattedOldDate = formatDateString(event.oldStart, event.oldEnd)
            const startTime = new Date(event.start?.date ?? event.start?.dateTime ?? "")
            await sendNotification("Rescheduled Event", ["arrows_counterclockwise"], `${event.summary}${formattedDate ? "\n🕑 " + formattedDate : ""}${formattedOldDate ? "\n❌ " + formattedOldDate : ""}${event.location ? "\n📌 " + event.location : ""}`, startTime)
        }
    }
}