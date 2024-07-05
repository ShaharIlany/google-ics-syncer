import type { calendar_v3 } from "googleapis"
import z from "zod"

export const ZoneRuleZod = z.object({
    freq: z.string(),
    interval: z.coerce.number(),
    byday: z.string(),
    bymonth: z.coerce.number()
})

export type ZoneRule = z.infer<typeof ZoneRuleZod>

export const ZoneZod = z.object({
    dtstart: z.string(),
    tzoffsetfrom: z.string(),
    tzoffsetto: z.string(),
    rrule: ZoneRuleZod.nullable()
})

export type Zone = z.infer<typeof ZoneZod>

export const TimeZoneZod = z.object({
    tzid: z.string(),
    standard: ZoneZod,
    daylight: ZoneZod,
})

export type TimeZone = z.infer<typeof TimeZoneZod>

export const CalendarEventZod = z.object({
    uid: z.string(),
    description: z.string(),
    summary: z.string(),
    dtstart: z.string(),
    dtend: z.string(),
    class: z.string(),
    priority: z.coerce.number(),
    dtstamp: z.string(),
    transp: z.string(),
    status: z.string(),
    sequence: z.coerce.number(),
    location: z.string(),
    "x-microsoft-cdo-appt-sequence": z.coerce.number(),
    "x-microsoft-cdo-busystatus": z.string(),
    "x-microsoft-cdo-intendedstatus": z.string(),
    "x-microsoft-cdo-alldayevent": z.boolean(),
    "x-microsoft-cdo-importance": z.coerce.number(),
    "x-microsoft-cdo-insttype": z.coerce.number(),
    "x-microsoft-donotforwardmeeting": z.boolean(),
    "x-microsoft-disallow-counter": z.boolean(),
    "x-microsoft-requestedattendancemode": z.string(),
    "x-microsoft-isresponserequested": z.boolean(),
})

export type CalendarEvent = z.infer<typeof CalendarEventZod>

export const CalendarZod = z.object({
    method: z.string(),
    prodid: z.string(),
    version: z.coerce.number(),
    "x-wr-calname": z.string(),
    timezones: z.array(TimeZoneZod),
    events: z.array(CalendarEventZod)
})

export type Calendar = z.infer<typeof CalendarZod>

export type ReservedWord = {
    search: string;
    replace: string
}

export type MinifiedEvent = {
    googleEvent: calendar_v3.Schema$Event;
    summary: string;
    location?: string;
    start?: calendar_v3.Schema$EventDateTime;
    end?: calendar_v3.Schema$EventDateTime;
}