// app/api/resume-upload/route.ts
//
// Accepts a resume file (PDF, DOCX, or TXT), extracts the text,
// and returns it. Used by the mobile app and dashboard for resume upload.
//
// PDF: Claude API document reading (pdf-parse removed — it requires
//      DOM APIs that don't exist in serverless environments).
// DOCX: mammoth
// TXT: direct read

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import Anthropic from "@anthropic-ai/sdk"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

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
    // Auth is optional — free trial users don't have tokens.
    // This endpoint only extracts text from a file; it stores nothing.
    const authHeader = req.headers.get("authorization") || ""
    if (authHeader.match(/^Bearer\s+.+$/i)) {
      await getAuthedUser(req)
    }

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
      // Use Claude API to read PDF — pdf-parse requires DOM APIs
      // (DOMMatrix, ImageData) that don't exist in serverless environments.
      try {
        const anthropic = new Anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY,
        })

        const base64 = buffer.toString("base64")

        const message = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 4096,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "document",
                  source: {
                    type: "base64",
                    media_type: "application/pdf",
                    data: base64,
                  },
                },
                {
                  type: "text",
                  text: `Extract the complete text content of this resume. Return ONLY the raw text — no commentary, no formatting suggestions, no JSON. Preserve the structure: name, contact info, sections, job titles, companies, dates, bullet points, education, skills. Do not summarize. Return everything.`,
                },
              ],
            },
          ],
        })

        text = message.content
          .filter((block): block is Anthropic.TextBlock => block.type === "text")
          .map((block) => block.text)
          .join("\n")
          .trim()

        if (!text) {
          return withCorsJson(req, {
            error: "Could not extract text from this PDF. Try a different file or paste your resume text directly.",
          }, 400)
        }
      } catch (e: any) {
        console.error("[resume-upload] PDF extraction via Claude failed:", e?.message, e)
        return withCorsJson(req, {
          error: "PDF extraction failed. Please paste your resume text directly.",
        }, 400)
      }
    } else if (name.endsWith(".docx") || name.endsWith(".doc")) {
      // Use mammoth for DOCX text extraction
      try {
        const mammoth = await import("mammoth")
        const result = await mammoth.extractRawText({ buffer })
        text = result.value
      } catch (e: any) {
        console.error("[resume-upload] DOCX extraction failed:", e?.message)
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
    console.error("[resume-upload] Error:", msg)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
