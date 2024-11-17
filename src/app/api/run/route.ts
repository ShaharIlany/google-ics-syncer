import { OutlookEventZod } from "../../../types";

export async function POST(request: Request) {
    const r = await request.json()
    const data = OutlookEventZod.array().parse(r)
    // execute(data)
    data.forEach(d => {
        console.log(d)
    })
    return new Response();
    return Response.json(r);
}