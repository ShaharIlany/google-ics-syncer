import type { MinifiedEvent } from "./types"

const sendNotification = async (title: string, tags: string[], body: string) => {
    await fetch(`https://ntfy.sh/${process.env.NTFY_TOPIC_ID}`, {
        method: 'POST',
        headers: {
            'Title': title,
            'Click': 'https://calendar.google.com/calendar/u/0/r/day',
            'Tags': tags.join(",")
        },
        body,
    })
}

const getNotificationTitle = (addedEvents: MinifiedEvent[], deletedEvents: MinifiedEvent[]) => {
    if (addedEvents.length > 0 && deletedEvents.length > 0) {
        return `${addedEvents.length + deletedEvents.length} Events Updated`
    }
    if (addedEvents.length > 0) {
        return `${addedEvents.length} New Event${deletedEvents.length > 1 ? "s" : ""}`
    }
    if (deletedEvents.length > 0) {
        return `${deletedEvents.length} Canceled Event${deletedEvents.length > 1 ? "s" : ""}`
    }
    return "never"
}

const formatEventList = (events: MinifiedEvent[], prefix: string) =>
    events.map(({ summary }: MinifiedEvent) => `${prefix} ${summary.trim()}`).join("\n")

export const updateAboutEvents = async (addedEvents: MinifiedEvent[], deletedEvents: MinifiedEvent[]) => {
    const title = getNotificationTitle(addedEvents, deletedEvents)

    const addedEventsDescription = formatEventList(addedEvents, "📌")
    const canceledEventsDescription = formatEventList(deletedEvents, "🗑️")

    const body = [
        ...(addedEvents.length > 0 ? [addedEventsDescription] : []),
        ...(deletedEvents.length > 0 ? [canceledEventsDescription] : [])
    ]

    await sendNotification(title, ["spiral_calendar"], body.join("\n\n"))
}