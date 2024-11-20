import { google } from "googleapis"

const oauth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    process.env.REDIRECT
);

const home = async (request: Request) => {
    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/drive']
    });
    return Response.redirect(url, 307);
}

const redirect = async (request: Request) => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code")

    if (code) {
        const { tokens } = await oauth2Client.getToken(code)
        console.log(tokens)
        const res = await oauth2Client.refreshAccessToken()
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
            return new Response("404!");

        } catch (e) {
            return new Response(JSON.stringify(e));
        }
    },
});

console.log(`Listening on ${server.url}`);