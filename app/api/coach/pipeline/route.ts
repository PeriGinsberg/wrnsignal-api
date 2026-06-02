// app/api/coach/pipeline/route.ts
//
// Configurable prospect pipeline — per-coach config endpoints (spec §5, §7, §0.4).
//
// Routes:
//   GET — returns the authed coach's pipeline stages, ordered by sort_order.
//         LAZY SEED: if the coach has zero rows, seed the curated default set
//         (§3 + the terminal Convert stage §4) for that coach, then return it.
//   PUT — saves the coach's stage selection + order + custom stages. Server-side
//         guards: Convert stays present + pinned last; allow-listed editable
//         fields only; deselect = active:false (no hard delete); custom stages
//         get a generated stage_key + validated label.
//
// Auth: standard coach Bearer pattern, inlined per the coach-route convention.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { randomUUID } from "node:crypto"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// ── Curated default pipeline (spec §3 working stages + §4 terminal Convert) ──
// Seeded verbatim on first GET. is_custom=false, active=true for all.
const TERMINAL_STAGE_KEY = "convert_to_client"
const DEFAULT_STAGES: { stage_key: string; label: string; sort_order: number; is_terminal: boolean }[] = [
  { stage_key: "lead_identified",   label: "Lead Identified",   sort_order: 1,  is_terminal: false },
  { stage_key: "initial_contact",   label: "Initial Contact",   sort_order: 2,  is_terminal: false },
  { stage_key: "consult_scheduled", label: "Consult Scheduled", sort_order: 3,  is_terminal: false },
  { stage_key: "consult_completed", label: "Consult Completed", sort_order: 4,  is_terminal: false },
  { stage_key: "sow_drafted",       label: "SOW Drafted",       sort_order: 5,  is_terminal: false },
  { stage_key: "sow_sent",          label: "SOW Sent",          sort_order: 6,  is_terminal: false },
  { stage_key: "sow_executed",      label: "SOW Executed",      sort_order: 7,  is_terminal: false },
  { stage_key: "invoice_drafted",   label: "Invoice Drafted",   sort_order: 8,  is_terminal: false },
  { stage_key: "invoice_sent",      label: "Invoice Sent",      sort_order: 9,  is_terminal: false },
  { stage_key: "invoice_paid",      label: "Invoice Paid",      sort_order: 10, is_terminal: false },
  { stage_key: TERMINAL_STAGE_KEY,  label: "Convert to Client", sort_order: 11, is_terminal: true },
]

const LABEL_MAX = 60

type StageRow = {
  id: string
  coach_profile_id: string
  stage_key: string
  label: string
  sort_order: number
  is_custom: boolean
  is_terminal: boolean
  active: boolean
  created_at: string
  updated_at: string
}

const STAGE_SELECT =
  "id, coach_profile_id, stage_key, label, sort_order, is_custom, is_terminal, active, created_at, updated_at"

// ── Auth helpers (inlined per coach-route convention; copied from
//    app/api/coach/prospects/route.ts) ──
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
  return {
    userId: data.user.id,
    email: (data.user.email ?? "").trim().toLowerCase() || null,
  }
}

async function getCoachProfile(userId: string, email: string | null) {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from("client_profiles")
    .select("id, name, is_coach, coach_org")
    .eq("user_id", userId)
    .maybeSingle()
  if (data) return data
  if (email) {
    const { data: byEmail } = await supabase
      .from("client_profiles")
      .select("id, name, is_coach, coach_org, user_id")
      .eq("email", email)
      .maybeSingle()
    if (byEmail) {
      if (byEmail.user_id !== userId) {
        await supabase
          .from("client_profiles")
          .update({ user_id: userId, updated_at: new Date().toISOString() })
          .eq("id", byEmail.id)
      }
      const { user_id: _u, ...rest } = byEmail as any
      return rest
    }
  }
  return null
}

function toApiStage(r: StageRow) {
  return {
    id: r.id,
    stage_key: r.stage_key,
    label: r.label,
    sort_order: r.sort_order,
    is_custom: r.is_custom,
    is_terminal: r.is_terminal,
    active: r.active,
  }
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

// ── GET: read (lazy-seed on first access) ──
export async function GET(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const coach = await getCoachProfile(userId, email)
    if (!coach) return withCorsJson(req, { ok: false, error: "Profile not found" }, 404)
    if (!coach.is_coach) return withCorsJson(req, { ok: false, error: "Forbidden: coach access required" }, 403)
    const coachProfileId = coach.id as string

    const supabase = getSupabaseAdmin()
    const { data: existing, error: readErr } = await supabase
      .from("coach_pipeline_stages")
      .select(STAGE_SELECT)
      .eq("coach_profile_id", coachProfileId)
      .order("sort_order", { ascending: true })
    if (readErr) {
      return withCorsJson(req, { ok: false, error: `Failed to read pipeline: ${readErr.message}` }, 500)
    }

    if (existing && existing.length > 0) {
      return withCorsJson(req, { ok: true, stages: (existing as StageRow[]).map(toApiStage) })
    }

    // Lazy seed: no rows yet → insert the curated default for this coach.
    const seedRows = DEFAULT_STAGES.map((s) => ({
      coach_profile_id: coachProfileId,
      stage_key: s.stage_key,
      label: s.label,
      sort_order: s.sort_order,
      is_custom: false,
      is_terminal: s.is_terminal,
      active: true,
    }))
    const { data: seeded, error: seedErr } = await supabase
      .from("coach_pipeline_stages")
      .insert(seedRows)
      .select(STAGE_SELECT)
    if (seedErr) {
      // Concurrent first-access could race the seed insert and hit the
      // UNIQUE(coach_profile_id, stage_key) constraint. Re-read in that case.
      const { data: reread, error: rereadErr } = await supabase
        .from("coach_pipeline_stages")
        .select(STAGE_SELECT)
        .eq("coach_profile_id", coachProfileId)
        .order("sort_order", { ascending: true })
      if (rereadErr || !reread || reread.length === 0) {
        return withCorsJson(req, { ok: false, error: `Failed to seed pipeline: ${seedErr.message}` }, 500)
      }
      return withCorsJson(req, { ok: true, stages: (reread as StageRow[]).map(toApiStage), seeded: true })
    }

    const ordered = (seeded as StageRow[]).sort((a, b) => a.sort_order - b.sort_order)
    return withCorsJson(req, { ok: true, stages: ordered.map(toApiStage), seeded: true })
  } catch (e: any) {
    const msg = e?.message || String(e)
    const status = /unauthorized/i.test(msg) ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}

// ── PUT: save selection + order + custom stages ──
//
// Body shape:
//   { stages: [ { stage_key?, label?, sort_order, active, is_custom? } , ... ] }
// Each entry is one stage in the coach's desired pipeline:
//   - existing master/custom stage: identified by stage_key (must already exist
//     for this coach). active + sort_order + (custom) label are editable.
//   - new custom stage: is_custom=true, no stage_key (server generates one),
//     label required.
// NOT editable: is_terminal, and the Convert stage's identity/position.
type PutStage = {
  stage_key?: string
  label?: string
  sort_order?: number
  active?: boolean
  is_custom?: boolean
}

export async function PUT(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const coach = await getCoachProfile(userId, email)
    if (!coach) return withCorsJson(req, { ok: false, error: "Profile not found" }, 404)
    if (!coach.is_coach) return withCorsJson(req, { ok: false, error: "Forbidden: coach access required" }, 403)
    const coachProfileId = coach.id as string

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object" || !Array.isArray((body as any).stages)) {
      return withCorsJson(req, { ok: false, error: "Body must be { stages: [...] }" }, 400)
    }
    const incoming = (body as any).stages as PutStage[]
    if (incoming.length === 0) {
      return withCorsJson(req, { ok: false, error: "stages cannot be empty" }, 400)
    }

    const supabase = getSupabaseAdmin()

    // Current rows for this coach — the source of truth for which stage_keys
    // exist and which is the terminal Convert stage.
    const { data: currentData, error: curErr } = await supabase
      .from("coach_pipeline_stages")
      .select(STAGE_SELECT)
      .eq("coach_profile_id", coachProfileId)
    if (curErr) return withCorsJson(req, { ok: false, error: `Failed to read pipeline: ${curErr.message}` }, 500)
    const current = (currentData || []) as StageRow[]
    if (current.length === 0) {
      return withCorsJson(req, { ok: false, error: "No pipeline to update — GET first to seed the default" }, 409)
    }
    const currentByKey = new Map(current.map((r) => [r.stage_key, r]))
    const terminal = current.find((r) => r.is_terminal)
    if (!terminal) {
      return withCorsJson(req, { ok: false, error: "Pipeline has no terminal Convert stage (corrupt state)" }, 500)
    }

    // ── Validate the incoming set ──
    const seenKeys = new Set<string>()
    let terminalSeen = false
    let maxNonTerminalSort = -Infinity
    let terminalSort = -Infinity

    type Resolved =
      | { kind: "update"; row: StageRow; sort_order: number; active: boolean; label: string }
      | { kind: "insert"; stage_key: string; label: string; sort_order: number }

    const resolved: Resolved[] = []

    for (const s of incoming) {
      if (typeof s.sort_order !== "number" || !Number.isInteger(s.sort_order)) {
        return withCorsJson(req, { ok: false, error: "Each stage needs an integer sort_order" }, 400)
      }

      // New custom stage: no stage_key, is_custom must be true, label required.
      if (!s.stage_key) {
        if (s.is_custom !== true) {
          return withCorsJson(req, { ok: false, error: "Stage without stage_key must be is_custom:true" }, 400)
        }
        const label = typeof s.label === "string" ? s.label.trim() : ""
        if (!label) return withCorsJson(req, { ok: false, error: "Custom stage label is required" }, 400)
        if (label.length > LABEL_MAX) {
          return withCorsJson(req, { ok: false, error: `Custom stage label too long (max ${LABEL_MAX})` }, 400)
        }
        const newKey = `custom_${randomUUID().slice(0, 12)}`
        resolved.push({ kind: "insert", stage_key: newKey, label, sort_order: s.sort_order })
        maxNonTerminalSort = Math.max(maxNonTerminalSort, s.sort_order)
        continue
      }

      // Existing stage: must belong to this coach.
      const row = currentByKey.get(s.stage_key)
      if (!row) {
        return withCorsJson(req, { ok: false, error: `Unknown stage_key: ${s.stage_key}` }, 400)
      }
      if (seenKeys.has(s.stage_key)) {
        return withCorsJson(req, { ok: false, error: `Duplicate stage_key in payload: ${s.stage_key}` }, 400)
      }
      seenKeys.add(s.stage_key)

      const active = typeof s.active === "boolean" ? s.active : row.active

      if (row.is_terminal) {
        // Convert stage: identity/terminality/active are NOT editable. Only its
        // continued presence + last position matter. Reject attempts to
        // deactivate or relabel it (allow-list discipline).
        terminalSeen = true
        terminalSort = s.sort_order
        if (active === false) {
          return withCorsJson(req, { ok: false, error: "The Convert stage cannot be deactivated" }, 400)
        }
        // label edits to the terminal stage are ignored (not allow-listed);
        // keep its existing label.
        resolved.push({ kind: "update", row, sort_order: s.sort_order, active: true, label: row.label })
        continue
      }

      // Non-terminal existing stage. Label editable only for custom stages
      // (master labels are fixed for cross-coach reporting).
      let label = row.label
      if (typeof s.label === "string" && row.is_custom) {
        const trimmed = s.label.trim()
        if (!trimmed) return withCorsJson(req, { ok: false, error: "Custom stage label cannot be empty" }, 400)
        if (trimmed.length > LABEL_MAX) {
          return withCorsJson(req, { ok: false, error: `Custom stage label too long (max ${LABEL_MAX})` }, 400)
        }
        label = trimmed
      }
      resolved.push({ kind: "update", row, sort_order: s.sort_order, active, label })
      maxNonTerminalSort = Math.max(maxNonTerminalSort, s.sort_order)
    }

    // ── Terminal-Convert guards (spec §4) ──
    if (!terminalSeen) {
      return withCorsJson(req, { ok: false, error: "The Convert stage must remain in the pipeline" }, 400)
    }
    if (terminalSort <= maxNonTerminalSort) {
      return withCorsJson(req, { ok: false, error: "The Convert stage must remain last (highest sort_order)" }, 400)
    }

    // ── Apply ──
    // Updates to existing rows (sort_order/active/label per the allow-list).
    for (const r of resolved) {
      if (r.kind === "update") {
        const { error: upErr } = await supabase
          .from("coach_pipeline_stages")
          .update({ sort_order: r.sort_order, active: r.active, label: r.label })
          .eq("id", r.row.id)
          .eq("coach_profile_id", coachProfileId)
        if (upErr) {
          return withCorsJson(req, { ok: false, error: `Failed to update stage ${r.row.stage_key}: ${upErr.message}` }, 500)
        }
      } else {
        const { error: insErr } = await supabase
          .from("coach_pipeline_stages")
          .insert({
            coach_profile_id: coachProfileId,
            stage_key: r.stage_key,
            label: r.label,
            sort_order: r.sort_order,
            is_custom: true,
            is_terminal: false,
            active: true,
          })
        if (insErr) {
          return withCorsJson(req, { ok: false, error: `Failed to add custom stage: ${insErr.message}` }, 500)
        }
      }
    }

    // Return the fresh ordered set.
    const { data: after, error: afterErr } = await supabase
      .from("coach_pipeline_stages")
      .select(STAGE_SELECT)
      .eq("coach_profile_id", coachProfileId)
      .order("sort_order", { ascending: true })
    if (afterErr) return withCorsJson(req, { ok: false, error: `Saved, but re-read failed: ${afterErr.message}` }, 500)
    return withCorsJson(req, { ok: true, stages: (after as StageRow[]).map(toApiStage) })
  } catch (e: any) {
    const msg = e?.message || String(e)
    const status = /unauthorized/i.test(msg) ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
