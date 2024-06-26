import {
    CalendarEventZod,
    CalendarZod,
    ZoneRuleZod,
    ZoneZod,
    type Calendar,
    type CalendarEvent,
    type TimeZone,
    type Zone,
    type ZoneRule
} from "./types"

const parseZoneRule = (data: string): ZoneRule | null => {
    const [_, rules] = data.split(":")
    if (!rules) {
        return null
    }
    return ZoneRuleZod.parse(rules.split(";").reduce((all, curr) => {
        const [key, value] = curr.split("=")
        return { ...all, [key.toLowerCase()]: value }
    }, {} as Record<string, string>))
}

const parseZone = (data: string): Zone => {
    const { lines, rule } = data.split(/\r\n(?=[A-Z])/g).reduce((all, line) => {
        if (line.startsWith("RRULE:")) {
            return { ...all, rule: line }
        }
        return { ...all, lines: [...all.lines, line] }
    }, { lines: [], rule: "" } as { lines: string[], rule: string })
    return ZoneZod.parse(lines.reduce((all, curr) => {
        const [key, ...partedValue] = curr.split(":")
        return { ...all, [key.toLowerCase()]: partedValue.join(":") }
    }, { rrule: parseZoneRule(rule) } as Record<string, any>))
}

const parseTimeZone = (data: string): TimeZone => {
    const standard = parseZone(data.match(/BEGIN:STANDARD.*?END:STANDARD/sg)?.[0] ?? "")
    const daylight = parseZone(data.match(/BEGIN:DAYLIGHT.*?END:DAYLIGHT/sg)?.[0] ?? "")
    return {
        tzid: data.match(/TZID:.*/g)?.[0].replace("TZID:", "") ?? "",
        standard,
        daylight
    }
}

const formatEventValue = (key: string, value: string) => {
    switch (key.toLowerCase()) {
        case "uid":
            return value.replaceAll(" ", "").replaceAll("\r", "").replaceAll("\n", "")
        case "x-microsoft-cdo-alldayevent":
        case "x-microsoft-donotforwardmeeting":
        case "x-microsoft-disallow-counter":
        case "x-microsoft-isresponserequested":
            return value.toLowerCase() === "true"
    }
    return value
}

const parseEvent = (data: string): CalendarEvent => {
    const lines = data.split(/\r\n(?=[A-Z])/g)
    return CalendarEventZod.parse(lines.reduce((all, curr) => {
        const semicolonLocation = curr.indexOf(";")
        const colonLocation = curr.indexOf(":")
        const [key, ...partedValue] = semicolonLocation > -1 && semicolonLocation < colonLocation ? curr.split(";") : curr.split(":")
        const value = formatEventValue(key, partedValue.join(":"))
        return { ...all, [key.toLowerCase()]: value }
    }, {} as Record<string, string | number | boolean>))
}

const parseCalendar = (data: string): Calendar => {
    const timezones = data.match(/BEGIN:VTIMEZONE.*?END:VTIMEZONE/sg)
    const events = data.match(/BEGIN:VEVENT.*?END:VEVENT/sg)
    const restOfTheKeys = Object.keys(CalendarZod.strict().shape).filter(key => !["timezones", "events"].includes(key.toLowerCase()))

    return CalendarZod.parse({
        timezones: timezones ? timezones.map(parseTimeZone) : [],
        events: events ? events.map(parseEvent) : [],
        ...restOfTheKeys.reduce((all, curr) => {
            return { ...all, [curr]: (data.match(new RegExp(String.raw`${curr.toUpperCase()}:.*`, "g"))?.[0].replace(`${curr.toUpperCase()}:`, "") ?? "") }
        }, {} as Record<string, string>)
    })
}

const parse = (data: string): Calendar[] => {
    const calendars = data.match(/BEGIN:VCALENDAR.*?END:VCALENDAR/sg)
    if (!calendars) {
        return []
    }
    return calendars.map(parseCalendar)
}

export default parse