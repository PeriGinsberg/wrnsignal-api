import { readFileSync } from "fs"
import { join } from "path"
import { NextResponse } from "next/server"

export async function GET() {
  const html = readFileSync(
    join(process.cwd(), "public/videos/dashboard.html"),
    "utf-8"
  )
  return new NextResponse(html, {
    headers: { "Content-Type": "text/html" },
  })
}