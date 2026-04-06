// app/api/resume-upload/route.ts
//
// Accepts a resume file (PDF, DOCX, or TXT), extracts the text,
// and returns it. Used by the mobile app for resume upload.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") || ""
  const m = h.match(/^Bearer\s+(.+)$/i)
  const token = m?.[1]?.trim()
  if (!token) throw new Error("Unauthorized: missing bearer token")
  return token
}

async function getAuthedUser(req: Request) {
  const token = getBearerToken(req)
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user?.id) throw new Error("Unauthorized: invalid token")
  return { userId: data.user.id }
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: NextRequest) {
  try {
    await getAuthedUser(req)

    const formData = await req.formData()
    const file = formData.get("file") as File | null

    if (!file) {
      return withCorsJson(req, { error: "No file uploaded" }, 400)
    }

    const name = file.name.toLowerCase()
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    let text = ""

    if (name.endsWith(".txt")) {
      text = buffer.toString("utf-8")
    } else if (name.endsWith(".pdf")) {
      try {
        const pdfParse = require("pdf-parse")
        const data = await pdfParse(buffer)
        text = data.text
      } catch (e: any) {
        return withCorsJson(req, { error: "Could not read PDF. Try pasting your resume text instead." }, 400)
      }
    } else if (name.endsWith(".docx") || name.endsWith(".doc")) {
      // Use mammoth for DOCX text extraction
      try {
        const mammoth = await import("mammoth")
        const result = await mammoth.extractRawText({ buffer })
        text = result.value
      } catch (e: any) {
        return withCorsJson(req, { error: "Could not read Word document. Try pasting your resume text instead." }, 400)
      }
    } else {
      return withCorsJson(req, { error: "Unsupported file type. Upload a PDF, DOCX, or TXT file." }, 400)
    }

    const trimmed = text.trim()
    if (!trimmed || trimmed.length < 50) {
      return withCorsJson(req, { error: "Could not extract enough text from the file. Try pasting your resume text instead." }, 400)
    }

    return withCorsJson(req, { ok: true, text: trimmed })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
