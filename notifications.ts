import { format, subDays } from "date-fns";
import type { MinifiedEvent } from "./types";
import type { calendar_v3 } from "googleapis";
import { asiaJerusalem } from "./utils";

const sendNotification = async (
  title: string,

  body: string,
  clickDate: Date
) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    console.log(
      "⚠️ TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set, skipping notification"
    );
    return;
  }

  const googleCalendarUrl = `https://calendar.google.com/calendar/u/0/r/day/${format(
    clickDate,
    "yyyy/M/d"
  )}`;

  const text = `${title}\n${body}`;

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "📅 Open in Google Calendar",
                  url: googleCalendarUrl,
                },
              ],
            ],
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.log(
        "❌ Failed to send Telegram notification:",
        response.status,
        response.statusText,
        errorText
      );
    }
  } catch (e) {
    console.log("❌ Error while sending Telegram notification:", e);
  }
};

const formatDateString = (
  start: calendar_v3.Schema$EventDateTime,
  end: calendar_v3.Schema$EventDateTime
) => {
  if (!start || !end) {
    return "";
  }

  if (start.date && end.date) {
    if (start.date === end.date) {
      // dd/MM/yyyy
      return format(asiaJerusalem(new Date(end.date)), "dd/MM/yyyy");
    } else {
      // dd/MM/yyyy - dd/MM/yyyy
      return `${format(
        asiaJerusalem(new Date(start.date)),
        "dd/MM/yyyy"
      )} - ${format(
        subDays(asiaJerusalem(new Date(end.date)), 1),
        "dd/MM/yyyy"
      )}`;
    }
  }

  if (start.dateTime && end.dateTime) {
    const iStart = asiaJerusalem(new Date(start.dateTime));
    const iEnd = asiaJerusalem(new Date(end.dateTime));
    if (format(iStart, "dd/MM/yyyy") === format(iEnd, "dd/MM/yyyy")) {
      // dd/MM/yyyy HH:mm - HH:mm
      return `${format(iStart, "dd/MM/yyyy HH:mm")} - ${format(iEnd, "HH:mm")}`;
    } else {
      // dd/MM/yyyy HH:mm - dd/MM/yyyy HH:mm
      return `${format(iStart, "dd/MM/yyyy HH:mm")} - ${format(
        iEnd,
        "dd/MM/yyyy HH:mm"
      )}`;
    }
  }

  return "";
};

export const updateAboutEvents = async (
  addedEvents: MinifiedEvent[],
  deletedEvents: MinifiedEvent[],
  rescheduledEvents: MinifiedEvent[]
) => {
  for (const event of addedEvents) {
    if (event.start && event.end) {
      const formattedDate = formatDateString(event.start, event.end);
      const startTime = new Date(
        event.start?.date ?? event.start?.dateTime ?? ""
      );
      await sendNotification(
        `➕ ${event.summary}`,
        `${formattedDate ? "🕑 " + formattedDate : ""}${
          event.location ? "\n📌 " + event.location : ""
        }`,
        startTime
      );
    }
  }

  for (const event of deletedEvents) {
    if (event.start && event.end) {
      const formattedDate = formatDateString(event.start, event.end);
      const startTime = new Date(
        event.start?.date ?? event.start?.dateTime ?? ""
      );
      await sendNotification(
        `❌ ${event.summary}`,
        `${formattedDate ? "🕑 " + formattedDate : ""}${
          event.location ? "\n📌 " + event.location : ""
        }`,
        startTime
      );
    }
  }

  for (const event of rescheduledEvents) {
    if (event.start && event.end && event.oldStart && event.oldEnd) {
      const formattedDate = formatDateString(event.start, event.end);
      const formattedOldDate = formatDateString(event.oldStart, event.oldEnd);
      const startTime = new Date(
        event.start?.date ?? event.start?.dateTime ?? ""
      );
      await sendNotification(
        `↩️ ${event.summary}`,
        `${formattedDate ? "🕑 " + formattedDate : ""}${
          formattedOldDate ? "\n❌ " + formattedOldDate : ""
        }${event.location ? "\n📌 " + event.location : ""}`,
        startTime
      );
    }
  }
};
