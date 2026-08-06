// app/api/interviews/[id]/prep/generate/route.ts
//
// The one LLM call behind Prep Now's generated zone.
//
// POST ONLY, and behind a button. Commit 2 established that a page VIEW never
// creates a prep row; generation costs money, so the same rule holds harder
// here. A glance at an interview must not bill a generation, and
// interview_prep_runs keeps meaning "someone actually worked on this".
//
// CACHED ON content_hash. A regeneration with unchanged inputs never reaches
// Anthropic — it returns the frozen artifact. That, and not temperature:0, is
// what makes "same inputs, same output" true. See lib/interviewPrep/contentHash.ts.
//
// FAILS CLOSED, which is the opposite of the semantic-relevance layer next door
// and deliberately so. There, failing open kept a credit the user had already
// earned. Here, failing open would mean showing someone fabricated interview
// prep they are about to walk into a room with. So on any error — no key, bad
// status, unparseable, or everything dropped by the validator — this writes
// NOTHING, caches NOTHING, and returns an honest failure with the button intact.
//
// A run whose result_json is a seeded stub is treated exactly like no run at
// all. Measured on dev: `jobfit_run_id != NULL` does not imply the analysis is
// there. See lib/interviewPrep/source.ts.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { invokeClaude, InvokeClaudeError, MODEL } from "../../../../../../lib/ai/anthropicClient"
import { centsForUsage } from "../../../../../../lib/ai/costPolicy"
import { buildPrepSource, jdState } from "../../../../../../lib/interviewPrep/source"
import { computeContentHash } from "../../../../../../lib/interviewPrep/contentHash"
import { buildUserPrompt, MAX_TOKENS, SYSTEM_PROMPT, TEMPERATURE } from "../../../../../../lib/interviewPrep/prompt"
import { parseResponse, validateGenerated } from "../../../../../../lib/interviewPrep/validate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
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
  return { userId: data.user.id, email: (data.user.email ?? "").trim().toLowerCase() || null }
}

async function getProfileId(userId: string, email: string | null) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from("client_profiles").select("id, user_id").eq("user_id", userId).maybeSingle()
  if (error) throw new Error(`Profile lookup failed: ${error.message}`)
  if (data) return data.id as string

  if (email) {
    const { data: byEmail, error: emailErr } = await supabase
      .from("client_profiles").select("id, user_id").eq("email", email).maybeSingle()
    if (emailErr) throw new Error(`Profile email lookup failed: ${emailErr.message}`)
    if (byEmail) {
      if (byEmail.user_id !== userId) {
        const { error: attachErr } = await supabase
          .from("client_profiles")
          .update({ user_id: userId, updated_at: new Date().toISOString() })
          .eq("id", byEmail.id)
        if (attachErr) throw new Error(`Profile attach failed: ${attachErr.message}`)
      }
      return byEmail.id as string
    }
  }
  throw new Error("Profile not found")
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!id) return withCorsJson(req, { ok: false, error: "Missing interview id" }, 400)

    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    // Ownership. Service-role bypasses RLS, so this comparison IS the access
    // control. Same gate as the sibling prep route.
    const { data: interview, error: ivErr } = await supabase
      .from("signal_interviews")
      .select("id, profile_id, application_id, interview_stage, interview_format")
      .eq("id", id)
      .maybeSingle()
    if (ivErr) throw new Error(`Interview lookup failed: ${ivErr.message}`)
    if (!interview) return withCorsJson(req, { ok: false, error: "Not found" }, 404)
    if (interview.profile_id !== profileId) return withCorsJson(req, { ok: false, error: "Forbidden" }, 403)

    // ── Is there anything to generate from? ──────────────────────────────────

    let jobfitRunId: string | null = null
    if (interview.application_id) {
      const { data: app } = await supabase
        .from("signal_applications")
        .select("jobfit_run_id")
        .eq("id", interview.application_id)
        .maybeSingle()
      jobfitRunId = (app?.jobfit_run_id as string) ?? null
    }
    if (!jobfitRunId) {
      return withCorsJson(req, { ok: true, generated: null, reason: "no_run" })
    }

    const { data: run, error: runErr } = await supabase
      .from("jobfit_runs")
      .select("id, result_json, job_description, fingerprint_hash")
      .eq("id", jobfitRunId)
      .maybeSingle()
    if (runErr) throw new Error(`Run lookup failed: ${runErr.message}`)

    // The candidate's stated targets, the only material behind why_this_job
    // and why_you. A failed read is not fatal: those two answers get less to
    // work with and the prompt says "(not stated)", which is honest.
    const { data: profile } = await supabase
      .from("client_profiles")
      .select("target_roles, target_locations")
      .eq("id", profileId)
      .maybeSingle()

    const source = buildPrepSource(run, profile)
    if (!source) {
      // TWO DIFFERENT REASONS, and they need different words in front of a
      // user. Measured on dev, both occur:
      //
      //   gated_pass  a real, complete run that hit a force_pass gate.
      //               enforceClientFacingRules zeroes why_codes on those, so
      //               there is no match evidence to draft an answer from. The
      //               analysis is fine; the verdict was "don't apply".
      //   thin_run    a seeded or partial row with no analysis in it at all.
      //
      // Telling someone with a gated Pass to "rescore" would be false advice,
      // which is why this is not one message.
      const gate = (run?.result_json as any)?.gate_triggered
      const reason = gate?.type === "force_pass" ? "gated_pass" : "thin_run"
      return withCorsJson(req, { ok: true, generated: null, reason })
    }

    const contentHash = computeContentHash({
      model: MODEL,
      jobfitRunId,
      runFingerprint: (run?.fingerprint_hash as string) ?? null,
      stage: interview.interview_stage ?? null,
      format: interview.interview_format ?? null,
    })

    // ── Cache ────────────────────────────────────────────────────────────────

    const { data: existing, error: findErr } = await supabase
      .from("interview_prep_runs")
      .select("id, generated, content_hash")
      .eq("interview_id", id)
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (findErr) throw new Error(`Prep lookup failed: ${findErr.message}`)

    if (existing?.generated && existing.content_hash === contentHash) {
      return withCorsJson(req, { ok: true, cached: true, generated: existing.generated })
    }

    // ── The call ─────────────────────────────────────────────────────────────

    let text: string
    let usage: { input_tokens: number; output_tokens: number }
    try {
      const res = await invokeClaude({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(source),
        maxTokens: MAX_TOKENS,
        temperature: TEMPERATURE,
      })
      text = res.text
      usage = res.usage
    } catch (err: any) {
      const detail = err instanceof InvokeClaudeError ? `http ${err.status}` : err?.message || String(err)
      console.error(`PREP_GENERATE_FAILED interview=${id} stage=call reason=${detail}`)
      return withCorsJson(req, { ok: false, error: "Generation failed" }, 502)
    }

    const generated = validateGenerated(parseResponse(text), source)
    if (!generated) {
      // Unparseable, or everything failed the grounding check. Nothing is
      // written and nothing is cached, so pressing the button again is a real
      // retry rather than a re-read of a bad artifact.
      console.error(`PREP_GENERATE_FAILED interview=${id} stage=validate chars=${text.length}`)
      return withCorsJson(req, { ok: false, error: "Generation failed" }, 502)
    }

    // ── Persist ──────────────────────────────────────────────────────────────

    // The posting verdict is STORED, not recomputed at render, because GET
    // does not load the run and half the inputs would be gone by then.
    //
    // THREE STATES. "absent" comes only from the mechanical check: whether a
    // posting was saved is a fact about our database, and the model is in no
    // position to have an opinion on it. "thin" is the OR of the char count and
    // the model's own read, either of which is enough. Anything else is ok.
    const state = jdState(source.jobDescription)
    const stored = {
      ...generated,
      jd_state: state === "absent" ? "absent" : state === "thin" || generated.jd_depth === "thin" ? "thin" : "ok",
    }

    const row = { generated: stored, content_hash: contentHash, jobfit_run_id: jobfitRunId }

    const { error: writeErr } = existing
      ? await supabase.from("interview_prep_runs").update(row).eq("id", existing.id)
      : await supabase.from("interview_prep_runs").insert({
          ...row,
          interview_id: id,
          profile_id: profileId,
        })

    if (writeErr) {
      // Loud, and greppable, per docs/silent-write-failures.md. The user still
      // gets their prep — refusing to show generated content because the cache
      // write failed would punish them for our problem — but the next visit
      // will regenerate, and that costs money, so this must not be silent.
      console.error(
        `ARTIFACT_WRITE_FAILED table=interview_prep_runs profileId=${profileId} reason=${writeErr.message}`,
      )
    }

    return withCorsJson(req, {
      ok: true,
      cached: false,
      generated: stored,
      cost_cents: centsForUsage(usage),
    })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : msg.includes("Profile not found") ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
