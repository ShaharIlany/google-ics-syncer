import { addMonths, format, parseISO, subWeeks } from "date-fns";
import { google, calendar_v3, drive_v3 } from "googleapis";
import z from "zod";

import { updateAboutEvents } from "./notifications";
import {
  type MinifiedEvent,
  type OutlookEvent,
  OutlookEventZod,
  ReservedWordZod,
} from "./types";
import { asiaJerusalem } from "./utils";

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET
);

oauth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });

const DOWNLOAD_CALENDAR_ID = process.env.DOWNLOAD_CALENDAR_ID;
const UPLOAD_CALENDAR_ID = process.env.UPLOAD_CALENDAR_ID;
const DRIVE_DIRECTORY_NAME = process.env.DRIVE_DIRECTORY_NAME;

type DateRange = {
  rangeStart: Date;
  rangeEnd: Date;
};

const SYNC_ID_PREFIX = "[SYNC_ID]:" as const;

const hashString = (value: string): string => {
  let hash = 0;

  for (let i = 0; i < value.length; i++) {
    const chr = value.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0; // Convert to 32bit integer
  }

  return Math.abs(hash).toString(16);
};

const buildEventId = (
  event: OutlookEvent,
  subject: string,
  location?: string
): string => {
  const identity = [
    subject.trim(),
    location ?? "",
    event.isAllDay ? "all-day" : "timed",
    event.start.toISOString(),
    event.end.toISOString(),
  ].join("|");

  return hashString(identity);
};

const extractSyncIdFromDescription = (
  description?: string | null
): string | null => {
  if (!description) return null;

  const match = description.match(/\[SYNC_ID\]:([a-f0-9]+)/);

  return match ? match[1] : null;
};

const getEventStartEnd = (
  event: OutlookEvent
): {
  start: calendar_v3.Schema$EventDateTime;
  end: calendar_v3.Schema$EventDateTime;
} => {
  if (event.isAllDay) {
    return {
      start: { date: format(event.start, "yyyy-MM-dd") },
      end: { date: format(event.end, "yyyy-MM-dd") },
    };
  }

  return {
    start: {
      dateTime: format(event.start, "yyyy-MM-dd'T'HH:mm:ssXXX"),
      timeZone: "Asia/Jerusalem",
    },
    end: {
      dateTime: format(event.end, "yyyy-MM-dd'T'HH:mm:ssXXX"),
      timeZone: "Asia/Jerusalem",
    },
  };
};

const buildProcessingRange = (now = new Date()): DateRange => {
  const rangeStart = subWeeks(now, 1);
  const rangeEnd = addMonths(now, 2);

  return { rangeStart, rangeEnd };
};

const logProcessingRange = ({ rangeStart, rangeEnd }: DateRange) => {
  console.log(
    `🗓️ Processing events in range ${rangeStart.toISOString()} → ${rangeEnd.toISOString()}`
  );
};

const filterEventsByDateRange = (
  events: OutlookEvent[],
  { rangeStart, rangeEnd }: DateRange
): OutlookEvent[] =>
  events.filter(
    (event) => event.start >= rangeStart && event.start <= rangeEnd
  );

const getRootDriveId = async (
  gDrive: drive_v3.Drive
): Promise<string | null> => {
  const root = await gDrive.files.get({ fileId: "root" });

  if (!root.data.id) {
    console.log("❌ Root drive not found");
    return null;
  }

  return root.data.id;
};

const getDirectoryId = async (
  gDrive: drive_v3.Drive,
  rootId: string
): Promise<string | null> => {
  const {
    data: { files: filesDirectory },
  } = await gDrive.files.list({
    pageSize: 10,
    fields: "files(id,name,parents)",
    q: `mimeType = 'application/vnd.google-apps.folder' and '${rootId}' in parents and name = '${DRIVE_DIRECTORY_NAME}'`,
  });

  const directoryId = filesDirectory?.[0].id ?? null;

  if (!directoryId) {
    console.log("📁 Directory not found.");
    return null;
  }

  return directoryId;
};

const getFileIdInFolder = async (
  gDrive: drive_v3.Drive,
  folderId: string,
  fileName: string,
  logLabel: string
): Promise<string | null> => {
  const { data } = await gDrive.files.list({
    pageSize: 10,
    fields: "files(id,name,parents)",
    q: `'${folderId}' in parents and name = '${fileName}'`,
  });

  const files = Array.isArray(data.files) ? data.files : [];
  const fileId =
    files.length > 0 && files[0].id ? (files[0].id as string) : null;

  if (!fileId) {
    console.log(`📄 ${logLabel} not found.`);
    return null;
  }

  return fileId;
};

const downloadAndParseArray = async <T>(
  gDrive: drive_v3.Drive,
  fileId: string,
  schema: z.ZodType<T>
): Promise<T[]> => {
  const { data } = await gDrive.files.get({
    fileId,
    alt: "media",
  });

  return schema.array().parse(data);
};

const normalizeSubject = (
  subject: string,
  reservedWords: { search: string; replace: string }[]
): string =>
  reservedWords
    .reduce(
      (value, reservedPhrase) =>
        value.replaceAll(reservedPhrase.search, reservedPhrase.replace),
      subject
    )
    .replaceAll(/[ ]+/g, " ");

const isEventCanceled = (subject: string): boolean =>
  subject.startsWith("canceled");

const isEventTooShort = (event: OutlookEvent): boolean =>
  +new Date(event.end) - +new Date(event.start) === 0;

const findMatchingGoogleEvent = (
  event: OutlookEvent,
  subject: string,
  location: string | undefined,
  googleEvents: calendar_v3.Schema$Event[]
): calendar_v3.Schema$Event | undefined => {
  const expectedId = buildEventId(event, subject, location);

  return googleEvents.find((googleEvent) => {
    const syncId = extractSyncIdFromDescription(googleEvent.description);
    if (syncId && syncId === expectedId) {
      return true;
    }

    if (!googleEvent.end) {
      return false;
    }

    // If the subjects are different then those are not the same events
    if (googleEvent.summary !== subject) {
      return false;
    }

    // If the locations are not the same then those are not the same events
    if (googleEvent.location !== location) {
      return false;
    }

    // If one of the events is all day and the second is not, then those are not the same events
    if (event.isAllDay !== !!googleEvent.end.date) {
      return false;
    }

    if (event.isAllDay) {
      console.log(
        " ->",
        googleEvent.end.date,
        format(asiaJerusalem(event.end), "yyyy-MM-dd")
      );
    }

    // If they are all day events but the end dates are different then those are not the same events
    if (
      event.isAllDay &&
      googleEvent.end.date !== format(asiaJerusalem(event.end), "yyyy-MM-dd")
    ) {
      return false;
    }

    // If they are not all day events but the end dates are different then those are not the same events
    if (
      !event.isAllDay &&
      format(
        asiaJerusalem(parseISO(googleEvent.end.dateTime ?? "")),
        "yyyy-MM-dd'T'HH:mm:ssXXX"
      ) !== format(asiaJerusalem(event.end), "yyyy-MM-dd'T'HH:mm:ssXXX")
    ) {
      return false;
    }

    return true;
  });
};

const listGoogleEventsInRange = async (
  gCal: calendar_v3.Calendar,
  calendarId: string,
  { rangeStart, rangeEnd }: DateRange
): Promise<calendar_v3.Schema$Event[]> =>
  (
    await gCal.events.list({
      calendarId,
      timeMin: rangeStart.toISOString(),
      timeMax: rangeEnd.toISOString(),
      maxResults: 1000,
      singleEvents: true,
      orderBy: "startTime",
    })
  ).data.items ?? [];

const filterFutureGoogleEvents = (
  events: calendar_v3.Schema$Event[]
): calendar_v3.Schema$Event[] => {
  const now = new Date();

  return events.filter((event) => {
    if (!event.start) {
      return false;
    }

    const startValue = event.start.dateTime ?? event.start.date;
    if (!startValue) {
      return false;
    }

    const eventStartDate = new Date(startValue);
    return eventStartDate >= now;
  });
};

const upsertJsonFileInDrive = async (
  gDrive: drive_v3.Drive,
  parentFolderId: string,
  fileName: string,
  data: unknown
) => {
  const fileId = await getFileIdInFolder(
    gDrive,
    parentFolderId,
    fileName,
    `${DRIVE_DIRECTORY_NAME}/${fileName}`
  );

  const media = {
    mimeType: "application/json",
    body: JSON.stringify(data, null, 2),
  };

  if (fileId) {
    await gDrive.files.update({
      fileId,
      media,
    });
  } else {
    await gDrive.files.create({
      requestBody: {
        name: fileName,
        parents: [parentFolderId],
      },
      media,
    });
  }
};

export const execute = async () => {
  try {
    const gDrive = google.drive({ version: "v3", auth: oauth2Client });
    const gCal = google.calendar({ version: "v3", auth: oauth2Client });

    if (!DOWNLOAD_CALENDAR_ID) {
      console.log(
        "❌ DOWNLOAD_CALENDAR_ID env var is not set. Exiting download sync phase."
      );
      return;
    }

    const rootId = await getRootDriveId(gDrive);
    if (!rootId) {
      return;
    }

    const directoryId = await getDirectoryId(gDrive, rootId);
    if (!directoryId) {
      return;
    }

    const dataFileId = await getFileIdInFolder(
      gDrive,
      directoryId,
      "data.json",
      `${DRIVE_DIRECTORY_NAME}/data.json`
    );
    if (!dataFileId) {
      return;
    }

    const configFileId = await getFileIdInFolder(
      gDrive,
      directoryId,
      "config.json",
      `${DRIVE_DIRECTORY_NAME}/config.json`
    );
    if (!configFileId) {
      return;
    }

    const outlookEvents = await downloadAndParseArray(
      gDrive,
      dataFileId,
      OutlookEventZod
    );
    const reservedWords = await downloadAndParseArray(
      gDrive,
      configFileId,
      ReservedWordZod
    );

    console.log(
      `⬇️ Downloaded ${outlookEvents.length} events. Starting sync...`
    );

    const dateRange = buildProcessingRange();
    logProcessingRange(dateRange);

    console.log(`📥 Outlook events loaded: ${outlookEvents.length}`);

    const filteredOutlookEvents = filterEventsByDateRange(
      outlookEvents,
      dateRange
    );

    console.log(`🔍 Filtered events in range: ${filteredOutlookEvents.length}`);

    if (filteredOutlookEvents.length === 0) {
      console.log("ℹ️ No events found in the requested date range. Exiting.");
      return;
    }

    const addedEvents: MinifiedEvent[] = [];
    const deletedEvents: MinifiedEvent[] = [];
    const rescheduledEvents: MinifiedEvent[] = [];

    const dateSorted = filteredOutlookEvents.toSorted(
      (a, b) => +a.start - +b.start
    );
    const earliestDate = dateSorted[0].start;

    console.log(
      `⏱️ Earliest event in range starts at ${earliestDate.toISOString()}`
    );

    let googleEvents = await listGoogleEventsInRange(
      gCal,
      DOWNLOAD_CALENDAR_ID,
      dateRange
    );

    for (const event of filteredOutlookEvents) {
      console.log("");
      console.log(`🆕 Starting to process new event`);

      const uidForLogs = event.id.substring(event.id.length - 10);
      const subject = normalizeSubject(event.subject, reservedWords);
      const location = event.location.length > 1 ? event.location : undefined;

      if (isEventCanceled(subject)) {
        console.log(`<${uidForLogs}> ❌ Event is canceled, skipping`);
        continue;
      }

      if (isEventTooShort(event)) {
        console.log(
          `<${uidForLogs}> ⏱️ Event is less than 1 minute long, skipping`
        );
        continue;
      }

      console.log(
        `<${uidForLogs}> 🔎 Looking for matching event on Google Calendar`
      );

      const matchingGoogleEvent = findMatchingGoogleEvent(
        event,
        subject,
        location,
        googleEvents
      );

      if (matchingGoogleEvent) {
        console.log(
          `<${uidForLogs}> ✅ Found matching event. Skipping creation`
        );
        googleEvents = googleEvents.filter(
          (googleEvent) => googleEvent.id !== matchingGoogleEvent.id
        );
      } else {
        console.log(`<${uidForLogs}> 📅 Inserting event into Google Calendar`);
        const { start, end } = getEventStartEnd(event);

        const newEvent = await gCal.events.insert({
          calendarId: DOWNLOAD_CALENDAR_ID,
          requestBody: {
            summary: subject,
            location,
            start,
            end,
            description: `${SYNC_ID_PREFIX}${buildEventId(
              event,
              subject,
              location
            )}`,
          },
        });

        addedEvents.push({
          summary: subject,
          start,
          end,
          location,
          googleEvent: newEvent.data,
        });
      }

      console.log(`<${uidForLogs}> ✅ Done processing event`);
    }

    const futureGoogleEvents = filterFutureGoogleEvents(googleEvents);

    console.log(
      `✅ Finished syncing. Added events: ${addedEvents.length}, Remaining Google events: ${futureGoogleEvents.length}`
    );

    if (futureGoogleEvents.length > 0) {
      console.log(
        "🗑️ Deleting remaining future Google events not matched to Outlook"
      );

      for (const event of futureGoogleEvents) {
        const { id, start, end, location, summary } = event;

        if (!id || !start || !end) {
          console.log("⚠️ Event has no ID, start or end, skipping");
          continue;
        }

        const uidForLogs = id.substring(0, 5);

        console.log(
          `<${uidForLogs}> 🔁 Checking for matching events that were newly added`
        );

        const rescheduledEvent = addedEvents.find((e) => e.summary === summary);

        if (rescheduledEvent && rescheduledEvent.googleEvent.id) {
          console.log(`<${uidForLogs}> 🔁 This event is rescheduled.`);
          console.log(
            `<${uidForLogs}> ✏️ Updating the current event with the old properties`
          );

          const { start: _, end: __, ...oldProperties } = event;

          await gCal.events.update({
            calendarId: DOWNLOAD_CALENDAR_ID,
            eventId: rescheduledEvent.googleEvent.id,
            requestBody: {
              start: rescheduledEvent.googleEvent.start,
              end: rescheduledEvent.googleEvent.end,
              ...oldProperties,
            },
          });

          rescheduledEvents.push({
            summary: summary ?? "",
            start: rescheduledEvent.start,
            end: rescheduledEvent.end,
            location: location ?? "",
            googleEvent: event,
            oldEnd: end,
            oldStart: start,
          });

          console.log(
            `<${uidForLogs}> 🧹 Removing event from added event list (handled as reschedule)`
          );

          addedEvents.splice(
            addedEvents.findIndex(
              (i) => i.googleEvent.id === rescheduledEvent.googleEvent.id
            ),
            1
          );
        } else {
          console.log(
            `<${uidForLogs}> 🗑️ No matching new event found, marking as deleted`
          );

          deletedEvents.push({
            summary: summary ?? "",
            start,
            end,
            location: location ?? "",
            googleEvent: event,
          });
        }

        await gCal.events.delete({
          calendarId: DOWNLOAD_CALENDAR_ID,
          eventId: id,
        });
      }
    }

    if (
      deletedEvents.length > 0 ||
      addedEvents.length > 0 ||
      rescheduledEvents.length > 0
    ) {
      console.log(`📣 Sending notification about events update`);

      await updateAboutEvents(addedEvents, deletedEvents, rescheduledEvents);

      console.log(`✅ Notification sent`);
    }

    if (!UPLOAD_CALENDAR_ID) {
      console.log(
        "ℹ️ UPLOAD_CALENDAR_ID env var is not set. Skipping upload sync phase."
      );
    } else {
      console.log(
        "⬆️ Starting upload sync phase from Google Calendar to Drive"
      );

      const uploadEvents =
        (
          await gCal.events.list({
            calendarId: UPLOAD_CALENDAR_ID,
            timeMin: new Date().toISOString(),
            maxResults: 1000,
            singleEvents: true,
            orderBy: "startTime",
          })
        ).data.items ?? [];

      console.log(
        `📤 Upload phase: fetched ${uploadEvents.length} upcoming events from upload calendar`
      );

      await upsertJsonFileInDrive(
        gDrive,
        directoryId,
        "upload.json",
        uploadEvents
      );

      console.log(
        `📁 Upload phase: wrote ${uploadEvents.length} events to upload.json`
      );
    }

    console.log(
      `📊 Summary | Added: ${addedEvents.length}, Deleted: ${deletedEvents.length}, Rescheduled: ${rescheduledEvents.length}`
    );
  } catch (e) {
    console.log("❌ Error during sync:", e);
  }
};

await execute();
