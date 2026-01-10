export function GET() {
  return Response.json({ ok: true, route: "ping" }, { status: 200 });
}
