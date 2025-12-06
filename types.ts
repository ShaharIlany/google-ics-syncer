import type { calendar_v3 } from "googleapis";
import z from "zod";

export const OutlookEventZod = z.object({
  subject: z.string(),
  start: z.coerce.date(),
  end: z.coerce.date(),
  startWithTimeZone: z.coerce.date(),
  endWithTimeZone: z.coerce.date(),
  body: z.string(),
  isHtml: z.boolean(),
  responseType: z.string(),
  responseTime: z.coerce.date(),
  id: z.string(),
  createdDateTime: z.coerce.date(),
  lastModifiedDateTime: z.coerce.date(),
  organizer: z.string(),
  timeZone: z.string(),
  iCalUId: z.string(),
  categories: z.string().array(),
  webLink: z.string(),
  requiredAttendees: z.string(),
  optionalAttendees: z.string(),
  resourceAttendees: z.string(),
  location: z.string(),
  importance: z.string(),
  isAllDay: z.boolean(),
  recurrence: z.string(),
  reminderMinutesBeforeStart: z.number(),
  isReminderOn: z.boolean(),
  showAs: z.string(),
  responseRequested: z.boolean(),
  sensitivity: z.string(),
});

export type OutlookEvent = z.infer<typeof OutlookEventZod>;

export const ZoneRuleZod = z.object({
  freq: z.string(),
  interval: z.coerce.number(),
  byday: z.string(),
  bymonth: z.coerce.number(),
});

export type ZoneRule = z.infer<typeof ZoneRuleZod>;

export const ZoneZod = z.object({
  dtstart: z.string(),
  tzoffsetfrom: z.string(),
  tzoffsetto: z.string(),
  rrule: ZoneRuleZod.nullable(),
});

export type Zone = z.infer<typeof ZoneZod>;

export const TimeZoneZod = z.object({
  tzid: z.string(),
  standard: ZoneZod,
  daylight: ZoneZod,
});

export type TimeZone = z.infer<typeof TimeZoneZod>;

export const ReservedWordZod = z.object({
  search: z.string(),
  replace: z.string(),
});

export type ReservedWord = z.infer<typeof ReservedWordZod>;

export type MinifiedEvent = {
  googleEvent: calendar_v3.Schema$Event;
  summary: string;
  location?: string;
  start?: calendar_v3.Schema$EventDateTime;
  end?: calendar_v3.Schema$EventDateTime;
  oldStart?: calendar_v3.Schema$EventDateTime;
  oldEnd?: calendar_v3.Schema$EventDateTime;
};
