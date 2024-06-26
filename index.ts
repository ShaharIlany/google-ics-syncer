import { google, calendar_v3 } from "googleapis"
import parse from "./parseICS";
import type { CalendarEvent } from "./types";
// import { reserved } from "./reservedWords";

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT
);

const home = async (request: Request) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly']
  });
  return Response.redirect(url, 307);
}

const redirect = async (request: Request) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code")

  if (code) {
    const { tokens } = await oauth2Client.getToken(code)
    oauth2Client.setCredentials(tokens);
    const headers = new Headers();
    headers.append('Set-Cookie', `google-ics-syncer-access=${tokens.access_token}; HttpOnly`)
    headers.append('Set-Cookie', `google-ics-syncer-refresh=${tokens.refresh_token}; HttpOnly`)
    return new Response(JSON.stringify(tokens), {
      headers
    });
  }

  console.error('Couldn\'t get token');
  return new Response("Error");
}

const calendars = async (request: Request) => {
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  const res = await calendar.calendarList.list()
  return new Response(JSON.stringify(res.data.items))
}

const events = async (request: Request) => {
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  const events = await calendar.events.list({
    calendarId: process.env.CALENDAR_ID,
    timeMin: new Date().toISOString(),
    maxResults: 1000,
    singleEvents: true,
    orderBy: 'startTime'
  })
  return new Response(JSON.stringify(events.data.items))
}

const parseDate = (dateString: string) => {
  const date = `${dateString.slice(0, 4)}-${dateString.slice(4, 6)}-${dateString.slice(6, 8)}`
  const time = dateString.length > 8 ? `${dateString.slice(8, 11)}:${dateString.slice(11, 13)}:${dateString.slice(13, 15)}` : ""
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

const test = async (request: Request) => {
  try {
    const res = await fetch(process.env.ICS_URL!)
    const data = await res.text()
    const calendars = parse(data)
    for (const calendar of calendars) {
      const gCal = google.calendar({ version: 'v3', auth: oauth2Client });
      let googleEvents = (await gCal.events.list({
        calendarId: process.env.CALENDAR_ID,
        timeMin: new Date().toISOString(),
        maxResults: 1000,
        singleEvents: true,
        orderBy: 'startTime'
      })).data.items ?? []

      for (const event of calendar.events) {
        // const summary = reserved.reduce((value, reservedPhrase) => value.replaceAll(reservedPhrase[0], reservedPhrase[1]), event.summary).replaceAll(/[ ]+/g, " ")
        const summary = event.summary.replaceAll(/[ ]+/g, " ")
        console.log(`[${summary}]: Starting process`)
        if (summary.startsWith("canceled")) {
          console.log(`[${summary}]: Event is canceled, skipping`)
          continue
        }
        const { start, end } = getEventStartEnd(event)

        console.log(`[${summary}]: Looking for matching event on google calendar`)
        const matchingGoogleEvent = googleEvents.find(googleEvent => {
          if (!googleEvent.end) {
            return false
          }
          if (googleEvent.summary !== summary) {
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
          console.log(`[${summary}]: Found matching event. Skipping`)
          googleEvents = googleEvents.filter(googleEvent => googleEvent.id !== matchingGoogleEvent.id)
        } else {
          console.log(`[${summary}]: !!!`)
          console.log(`[${summary}]: !!!`)
          console.log(`[${summary}]: Inserting event into google calendar`)
          console.log(`[${summary}]: !!!`)
          console.log(`[${summary}]: !!!`)

          await gCal.events.insert({
            calendarId: process.env.CALENDAR_ID,
            requestBody: {
              summary,
              start, end
            }
          })
        }
        console.log(`[${summary}]: Done`)

      }

      console.log(`Finished parsing for this calendar. Events left: ${googleEvents.length}`)
      if (googleEvents.length > 0) {
        console.log("Deleting left google events (probably canceled)")
        for (const event of googleEvents) {
          console.log(`[${event.summary}] Deleting`)
          if (!event.id) {
            console.log(`[${event.summary}] Can't delete event, no ID available`)
            continue
          }
          await gCal.events.delete({
            calendarId: process.env.CALENDAR_ID,
            eventId: event.id
          })
          console.log(`[${event.summary}] Deleted`)
        }
      }
    }

  } catch (e) {
    console.log("Error:", e)
  }
  return new Response("Done")
}

const server = Bun.serve({
  port: 3000,
  async fetch(request) {
    const cookies = request.headers.get('cookie')?.split(" ").reduce((prev, curr) => {
      const [key, value] = curr.split("=")
      return ({ ...prev, [key]: value });
    }, {} as Record<string, string>)
    if (cookies && "google-ics-syncer-access" in cookies && "google-ics-syncer-refresh" in cookies) {
      oauth2Client.setCredentials({ access_token: cookies["google-ics-syncer-access"], refresh_token: cookies["google-ics-syncer-refresh"] });
    }
    try {
      const url = new URL(request.url);
      if (url.pathname === "/") return await home(request);
      if (url.pathname === "/redirect") return await redirect(request);
      if (url.pathname === "/calendars") return await calendars(request);
      if (url.pathname === "/events") return await events(request);
      if (url.pathname === "/test") return await test(request);
      return new Response("404!");

    } catch (e) {
      return new Response(JSON.stringify(e));
    }
  },
});

console.log(`Listening on ${server.url}`);