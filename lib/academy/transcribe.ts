// lib/academy/transcribe.ts
//
// A verbatim transcript for one practice take.
//
// WHISPER, NOT GPT-4O-TRANSCRIBE. The coach needs the false starts, the
// "um, so", the repeated words and the self-corrections: they are how you see
// overexplaining. The newer models tidy speech into clean prose. whisper-1
// keeps more of it, and the prompt below (written in the disfluent style it
// should copy) nudges it further. verbose_json also gives segment times, and
// the first segment's start is the time to the first words.
//
// NEVER EDITED AFTER. What the model returns is stored as is. If it fails, the
// take says so (transcript_status 'failed' with the reason) and the coach can
// retry; nothing is invented to fill the gap.
//
// FROM THE AUDIO-ONLY FILE when there is one: a three-minute opus track is
// about 2 MB, well under Whisper's 25 MB limit, where the video of the same
// answer can be 40 MB. A take with no audio file falls back to the video and
// is marked 'unavailable' if that is over the limit.

import type { SupabaseClient } from "@supabase/supabase-js"
import OpenAI, { toFile } from "openai"

const LIMIT_BYTES = 25 * 1024 * 1024
const STYLE_PROMPT =
  "Um, so, I think the, uh, the main thing is... wait, let me back up. So the, the first thing I'd look at is, like, the customers. Okay."

type TakeRow = { id: string; storage_path: string; audio_path: string | null; mime: string }

export async function transcribeTake(db: SupabaseClient, takeId: string): Promise<{ ok: boolean; status: string; error?: string }> {
  const { data: take, error } = await db
    .from("practice_takes").select("id, storage_path, audio_path, mime").eq("id", takeId).maybeSingle()
  if (error || !take) return { ok: false, status: "failed", error: error?.message ?? "take not found" }
  const t = take as TakeRow

  const mark = (fields: Record<string, unknown>) =>
    db.from("practice_takes").update(fields).eq("id", takeId)

  if (!process.env.OPENAI_API_KEY) {
    await mark({ transcript_status: "unavailable", transcript_error: "Transcription is not configured on this server (no OPENAI_API_KEY)." })
    return { ok: false, status: "unavailable" }
  }
  await mark({ transcript_status: "pending", transcript_error: null })

  try {
    const path = t.audio_path || t.storage_path
    const { data: blob, error: dErr } = await db.storage.from("practice-takes").download(path)
    if (dErr || !blob) throw new Error(`download: ${dErr?.message ?? "no file"}`)
    if (blob.size > LIMIT_BYTES) {
      const why = `The recording is ${Math.round(blob.size / 1048576)} MB, over the 25 MB transcription limit, and there is no separate audio file.`
      await mark({ transcript_status: "unavailable", transcript_error: why })
      return { ok: false, status: "unavailable", error: why }
    }
    const type = (blob.type || t.mime || "audio/webm").split(";")[0]
    const ext = path.split(".").pop() || "webm"
    // Whisper picks the decoder from the file name, and "weba" is not one it
    // knows; opus in webm decodes fine as .webm.
    const name = `answer.${ext === "weba" ? "webm" : ext}`
    const file = await toFile(Buffer.from(await blob.arrayBuffer()), name, { type })

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const r = await client.audio.transcriptions.create({
      file,
      model: "whisper-1",
      response_format: "verbose_json",
      temperature: 0,
      language: "en",
      prompt: STYLE_PROMPT,
    })
    const segments = (r.segments ?? []).map((s) => ({ start: s.start, end: s.end, text: s.text }))
    const text = (r.text ?? "").trim()
    const firstSpeechMs = segments.length ? Math.round(segments[0].start * 1000) : null
    await mark({
      transcript: text,
      transcript_segments: segments,
      first_speech_ms: firstSpeechMs,
      transcript_status: "done",
      transcript_error: text ? null : "No speech was detected in this recording.",
      transcribed_at: new Date().toISOString(),
    })
    return { ok: true, status: "done" }
  } catch (e: any) {
    const msg = String(e?.message ?? e).slice(0, 500)
    console.error("[academy/transcribe]", takeId, msg)
    await mark({ transcript_status: "failed", transcript_error: msg })
    return { ok: false, status: "failed", error: msg }
  }
}
