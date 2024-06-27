import { format, subDays } from "date-fns"
import type { MinifiedEvent } from "./types"

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


const formatDateString = (event: MinifiedEvent) => {
    if (!event.start || !event.end) {
        return ""
    }

    if (event.start.date && event.end.date) {
        if (event.start.date === event.end.date) {
            // dd/MM/yyyy
            return format(new Date(event.end.date), "dd/MM/yyyy")
        } else {
            // dd/MM/yyyy - dd/MM/yyyy
            return `${format(new Date(event.start.date), "dd/MM/yyyy")} - ${format(subDays(new Date(event.end.date), 1), "dd/MM/yyyy")}`
        }
    }

    if (event.start.dateTime && event.end.dateTime) {
        const start = new Date(event.start.dateTime)
        const end = new Date(event.end.dateTime)
        if (format(start, "dd/MM/yyyy") === format(end, "dd/MM/yyyy")) {
            // dd/MM/yyyy HH:mm - HH:mm
            return `${format(start, "dd/MM/yyyy HH:mm")} - ${format(end, "HH:mm")}`
        } else {
            // dd/MM/yyyy HH:mm - dd/MM/yyyy HH:mm
            return `${format(start, "dd/MM/yyyy HH:mm")} - ${format(end, "dd/MM/yyyy HH:mm")}`
        }
    }

    return ""
}

export const updateAboutEvents = async (addedEvents: MinifiedEvent[], deletedEvents: MinifiedEvent[]) => {
    for (const event of addedEvents) {
        const formattedDate = formatDateString(event)
        const startTime = new Date(event.start?.date ?? event.start?.dateTime ?? "")
        await sendNotification("New Event", ["spiral_calendar"], `${event.summary}${formattedDate ? "\n🕑 " + formattedDate : ""}${event.location ? "\n📌 " + event.location : ""}`, startTime)
    }

    for (const event of deletedEvents) {
        const formattedDate = formatDateString(event)
        const startTime = new Date(event.start?.date ?? event.start?.dateTime ?? "")
        await sendNotification("Canceled Event", ["wastebasket"], `${event.summary}${formattedDate ? "\n🕑 " + formattedDate : ""}${event.location ? "\n📌 " + event.location : ""}`, startTime)
    }
}