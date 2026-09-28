// POST — a one-shot signed upload URL for one recording.
//
// THE BROWSER UPLOADS STRAIGHT TO STORAGE. A ninety-second video is tens of
// megabytes, and posting that through a serverless function would mean holding
// it in memory, hitting the request body limit, and paying for the transfer
// twice. The function only decides whether this person may write, and where.
//
// The path is chosen HERE, never sent by the client: `<round>/<question>/<id>`.
// That is what makes the register step able to check a take belongs to the
// round it claims, and it is why the client cannot name a path into somebody
// else's folder.

import { type NextRequest } from "next/server"
import { randomUUID } from "node:crypto"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { clientPracticeScope, loadRound, NotFoundError } from "@/lib/practice/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** What a browser might hand us, mapped to the extension we store it under. */
const EXT: Record<string, string> = {
  "video/webm": "webm",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "audio/webm": "weba",
  "audio/mp4": "m4a",
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ roundId: string }> }) {
  try {
    const { roundId } = await params
    const { db, actorId } = await clientPracticeScope(req)
    const { round } = await loadRound(db, roundId, { id: actorId, as: "client" })

    if (round.status === "submitted") {
      return withCorsJson(req, { ok: false, error: "You have already submitted this round" }, 409)
    }

    const body = await req.json().catch(() => null)
    const questionId = String(body?.question_id ?? "")
    if (!round.questions.some((q) => q.id === questionId)) {
      return withCorsJson(req, { ok: false, error: "That question is not in this round" }, 400)
    }

    // The mime comes from MediaRecorder and varies by browser, so an unknown
    // one is stored as webm rather than refused: getting the extension wrong
    // is cosmetic, refusing the upload loses the take.
    const mime = String(body?.mime ?? "video/webm").split(";")[0].trim()
    const ext = EXT[mime] ?? "webm"
    const path = `${roundId}/${questionId}/${randomUUID()}.${ext}`

    const { data, error } = await db.storage
      .from("practice-takes")
      .createSignedUploadUrl(path)
    if (error || !data) throw new Error(error?.message ?? "no signed url")

    return withCorsJson(req, {
      ok: true,
      path,
      token: data.token,
      signed_url: data.signedUrl,
      mime,
    })
  } catch (e: any) {
    if (e instanceof NotFoundError) return withCorsJson(req, { ok: false, error: "Not found" }, 404)
    console.error("[practice-upload-url]", e?.message ?? e)
    return withCorsJson(req, { ok: false, error: "Something went wrong" }, 500)
  }
}
