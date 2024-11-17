export const dynamic = 'force-dynamic'; // static by default, unless reading the request

export async function POST(request: Request) {
    const r = await request.json()
    console.log(r)
    return Response.json(r);
}