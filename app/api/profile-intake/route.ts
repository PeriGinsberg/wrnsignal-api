// app/api/profile-intake/route.ts
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"
import { getAuthedProfileText } from "../_lib/authProfile"

// ---------- ENV ----------
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

function requireEnv(name: string, v?: string) {
  if (!v) throw new Error(`Missing server env: ${name}`)
  return v
}

const supabaseAdmin = createClient(
  requireEnv("SUPABASE_URL", SUPABASE_URL),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY),
  { auth: { persistSession: false, autoRefreshToken: false } }
)

// ---------- CORS ----------
export async function OPTIONS(req: Request) {
  return corsOptionsResponse(req.headers.get("origin"))
}

// ---------- Types ----------
type IntakeBody = {
  name?: string | null
  current_status?: string | null
  university?: string | null
  major?: string | null
  grad_year?: string | null

  job_type?: string | null
  target_roles?: string | null
  target_locations?: string | null
  preferred_locations?: string | null
  timeline?: string | null

  strong_skills?: string | null
  biggest_concern?: string | null
  entry_openness?: string | null
  hard_nos?: string | null
  constraints?: string | null

  resume_text?: string | null
  writing_samples?: string | null
  extra_context?: string | null

  risk_overrides?: Record<string, any> | null
}

// ---------- Helpers ----------
function toText(v: unknown): string {
  if (v === null || v === undefined) return ""
  if (typeof v === "string") return v.trim()
  return String(v).trim()
}

function clampText(v: unknown, max = 20000): string {
  const t = toText(v)
  if (!t) return ""
  return t.length > max ? t.slice(0, max) : t
}

function splitList(raw: unknown, max = 20): string[] {
  const s = toText(raw)
  if (!s) return []
  return s
    .split(/[,;\n|]+/g)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, max)
}

function uniqueLower(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    const key = item.toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function parseGradYear(raw: unknown): number | null {
  const s = toText(raw).replace(/[^\d]/g, "")
  if (!s) return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  if (n < 2020 || n > 2035) return null
  return n
}

function getCurrentYearUtc(): number {
  return new Date().getUTCFullYear()
}

// Deterministic years-of-experience estimator.
//
// Handles three common patterns in order of reliability:
//   1. Explicit self-report: "10+ years", "5 years of experience"
//   2. Month-Year date ranges: "Feb 2020 – Jan 2025", "Aug 2019 - Feb 2020",
//      "Jan 2025 – Present". Overlapping ranges are merged so a candidate
//      isn't double-counted for concurrent roles.
//   3. Bare Year-Year ranges as a last resort: "2019 - 2022".
//
// Returns null only when nothing is found, so downstream code can distinguish
// "unknown" from "zero". Previously capped at 2 years for entry-level flows,
// which caused every senior candidate to score as a 2-year career pivoter.
function inferYearsExperienceApprox(resumeText: string): number | null {
  if (!resumeText || resumeText.trim().length === 0) return null

  // ── 1. Explicit self-report ─────────────────────────────────────────────
  // Match "10+ years", "5 years of experience", "twelve years". We only
  // accept values within [1, 50] to avoid catching "20 years ago" style
  // phrases that aren't referring to the candidate's own tenure.
  const explicit = resumeText.match(
    /\b(\d{1,2})\+?\s+years?\b(?!\s+(ago|old))/i
  )
  if (explicit?.[1]) {
    const v = parseInt(explicit[1], 10)
    if (Number.isFinite(v) && v >= 1 && v <= 50) return v
  }

  // ── 2. Month Year – Month Year (or Present) ranges ──────────────────────
  const monthMap: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sept: 8, sep: 8, oct: 9, nov: 10, dec: 11,
  }

  const now = new Date()
  const currentMonthsAbs = now.getUTCFullYear() * 12 + now.getUTCMonth()

  const ranges: Array<{ start: number; end: number }> = []

  // "Feb 2020 – Jan 2025" / "Feb 2020 - Present" / "Feb 2020 to Jan 2025"
  const monthRangeRx =
    /(jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec)[a-z]*\.?\s+(\d{4})\s*(?:[-–—]|to)\s*(?:(jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec)[a-z]*\.?\s+(\d{4})|present|current|now|today)/gi

  let m: RegExpExecArray | null
  while ((m = monthRangeRx.exec(resumeText)) !== null) {
    const startM = monthMap[m[1].toLowerCase()] ?? 0
    const startY = parseInt(m[2], 10)
    if (!Number.isFinite(startY) || startY < 1970 || startY > 2100) continue
    const startAbs = startY * 12 + startM

    let endAbs: number
    if (m[3] && m[4]) {
      const endM = monthMap[m[3].toLowerCase()] ?? 0
      const endY = parseInt(m[4], 10)
      if (!Number.isFinite(endY) || endY < 1970 || endY > 2100) continue
      endAbs = endY * 12 + endM
    } else {
      endAbs = currentMonthsAbs
    }

    if (endAbs >= startAbs) ranges.push({ start: startAbs, end: endAbs })
  }

  // ── 3. Bare "2019 – 2022" / "2019 to Present" ranges ────────────────────
  // Only used if we don't already have month-level data (or to extend it).
  const yearRangeRx =
    /\b(19[89]\d|20\d{2})\s*(?:[-–—]|to)\s*(?:(19[89]\d|20\d{2})|present|current|now|today)\b/gi
  while ((m = yearRangeRx.exec(resumeText)) !== null) {
    const startY = parseInt(m[1], 10)
    if (!Number.isFinite(startY)) continue
    const startAbs = startY * 12 // January of startY

    let endAbs: number
    if (m[2]) {
      const endY = parseInt(m[2], 10)
      if (!Number.isFinite(endY)) continue
      // Treat bare year end as December of that year (inclusive of the year)
      endAbs = endY * 12 + 11
    } else {
      endAbs = currentMonthsAbs
    }

    if (endAbs >= startAbs) ranges.push({ start: startAbs, end: endAbs })
  }

  if (ranges.length === 0) return null

  // Merge overlapping ranges so concurrent roles don't double-count.
  ranges.sort((a, b) => a.start - b.start)
  let totalMonths = 0
  let curStart = ranges[0].start
  let curEnd = ranges[0].end
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].start <= curEnd) {
      curEnd = Math.max(curEnd, ranges[i].end)
    } else {
      totalMonths += curEnd - curStart
      curStart = ranges[i].start
      curEnd = ranges[i].end
    }
  }
  totalMonths += curEnd - curStart

  const years = Math.round(totalMonths / 12)
  if (years < 0) return 0
  if (years > 50) return 50
  return years
}

function extractTools(resumeText: string): string[] {
  const t = resumeText.toLowerCase()
  const tools: string[] = []

  const map: Array<[string, RegExp]> = [
    ["canva", /\bcanva\b/i],
    ["capcut", /\bcapcut\b/i],
    ["meta business suite", /\bmeta business suite\b/i],
    ["hubspot", /\bhubspot\b/i],
    ["shopify", /\bshopify\b/i],
    ["google analytics", /\bgoogle analytics\b|\bga4\b/i],
    ["amazon marketplace", /\bamazon marketplace\b/i],
    ["excel", /\bexcel\b|\bmicrosoft excel\b/i],
    ["google sheets", /\bgoogle sheets\b/i],
    ["powerpoint", /\bpowerpoint\b|\bmicrosoft powerpoint\b/i],
    ["word", /\bmicrosoft word\b/i],
    ["sql", /\bsql\b/i],
    ["r", /(^|[^a-z])r([^a-z]|$)/i],
    ["power bi", /\bpower\s*bi\b/i],
    ["looker", /\blooker\b/i],
    ["tableau", /\btableau\b/i],
    ["salesforce", /\bsalesforce\b/i],
    ["netsuite", /\bnetsuite\b/i],
    ["quickbooks", /\bquickbooks\b/i],
    ["workday", /\bworkday\b/i],
    ["adp", /\badp\b/i],
    ["coupa", /\bcoupa\b/i],
    ["concur", /\bconcur\b/i],
    ["sap", /\bsap\b/i],
    ["oracle", /\boracle\b/i],
  ]

  for (const [label, rx] of map) {
    if (rx.test(t)) tools.push(label)
  }

  // "Microsoft Office Suite" / "MS Office" / "Office 365" implies the core
  // trio. Previously a candidate who wrote "Microsoft Office Suite" but
  // didn't spell out each app individually got zero credit for Excel and
  // PowerPoint, which then fired RISK_MISSING_TOOLS against any role
  // mentioning those tools.
  const mentionsOfficeSuite =
    /\b(microsoft office suite|ms office suite|ms office|microsoft office|office 365|o365|office suite)\b/i.test(t)
  if (mentionsOfficeSuite) {
    tools.push("excel", "powerpoint", "word")
  }

  // "Google Workspace" / "G Suite" implies Google's productivity trio.
  const mentionsGoogleWorkspace =
    /\b(google workspace|g ?suite|google g ?suite)\b/i.test(t)
  if (mentionsGoogleWorkspace) {
    tools.push("google sheets", "google docs", "google slides")
  }

  return uniqueLower(tools)
}

function inferTargetFamilies(targetRoles: string[]): string[] {
  const joined = targetRoles.join(" | ").toLowerCase()
  const out: string[] = []

  if (/\b(marketing|brand|content|social|growth|ecommerce)\b/.test(joined)) {
    out.push("Marketing")
  }
  if (/\b(finance|investment|banking|wealth|asset|financial advisor|financial planner|wealth advisor)\b/.test(joined)) {
    out.push("Finance")
  }
  if (/\b(accounting|audit|tax|assurance)\b/.test(joined)) {
    out.push("Accounting")
  }
  // Consulting family covers strategy, business operations, chief of staff,
  // and HR business partner roles because the scoring engine currently has
  // no dedicated Operations or HR family. These roles all sit in the same
  // "cross-functional strategic operator" space as management consulting,
  // so we route them to Consulting rather than "Other" (which would fire
  // a false family-mismatch against any real job).
  if (/\b(consulting|strategy|business strategy|management consulting|strategy consulting|chief of staff|cos\b|business operations|business ops|strategy and operations|strategy & operations|strategic operations|operations manager|operations director|hrbp|hr business partner|people operations|people ops|people partner|internal operations)\b/.test(joined)) {
    out.push("Consulting")
  }
  if (/\b(policy|regulatory|government|legislative|compliance)\b/.test(joined)) {
    out.push("Government")
  }
  if (/\b(design|creative|visual)\b/.test(joined)) {
    out.push("Design")
  }
  if (/\b(sales|business development|account executive|account manager|medical sales|orthopedic sales)\b/.test(joined)) {
    out.push("Sales")
  }
  if (/\b(clinical|patient|premed|pre-med|healthcare|nurs|physician|medical assistant)\b/.test(joined)) {
    out.push("PreMed")
  }
  if (/\b(software engineer|software developer|frontend|backend|full stack|fullstack|web developer|mobile developer|devops|swe)\b/.test(joined)) {
    out.push("IT_Software")
  }
  if (/\b(engineer|engineering|biomedical|bioengineer|mechanical|electrical|civil engineer|chemical engineer|medical device)\b/.test(joined)) {
    out.push("Engineering")
  }
  if (/\b(analytics|data analyst|business intelligence|tableau|power bi)\b/.test(joined)) {
    out.push("Analytics")
  }

  return out.length ? out : ["Other"]
}

function inferLocationPreference(
  targetLocations: string,
  preferredLocations: string
) {
  const combined = [targetLocations, preferredLocations].filter(Boolean).join(" | ")
  const allowedCities = uniqueLower(splitList(combined, 20))

  return {
    mode: allowedCities.length ? "unclear" : "unknown",
    constrained: false,
    allowedCities,
  }
}

function buildCanonicalProfileText(body: IntakeBody): string {
  const blocks = [
    line("Name", body.name),
    line("Current status", body.current_status),
    line("University", body.university),
    line("Major", body.major),
    line("Graduation year", body.grad_year),

    line("Job type", body.job_type),
    line("Target roles", body.target_roles),
    line("Target locations", body.target_locations),
    line("Preferred locations", body.preferred_locations),
    line("Timeline", body.timeline),

    line("Strong skills", body.strong_skills),
    line("Biggest concern", body.biggest_concern),
    line("Openness to non-obvious entry points", body.entry_openness),
    line("Hard no's", body.hard_nos),
    line("Constraints", body.constraints),

    section("Resume", body.resume_text),
    section("Writing samples", body.writing_samples),
    section("Extra context", body.extra_context),
  ].filter(Boolean)

  return blocks.join("\n\n").trim()
}

function line(label: string, value: unknown): string {
  const t = toText(value)
  return t ? `${label}: ${t}` : ""
}

function section(label: string, value: unknown): string {
  const t = clampText(value, 120000)
  return t ? `${label}:\n${t}` : ""
}

function buildProfileStructuredForJobFit(body: IntakeBody) {
  const resumeText = clampText(body.resume_text, 120000)
  const targetRoles = splitList(body.target_roles, 20)
  const targetLocations = clampText(body.target_locations, 4000)
  const preferredLocations = clampText(body.preferred_locations, 4000)
  const gradYear = parseGradYear(body.grad_year)
  const yearsExperienceApprox = inferYearsExperienceApprox(resumeText)
  const tools = extractTools(resumeText)
  const targetFamilies = inferTargetFamilies(targetRoles)

  return {
    tools,
    gradYear,
    yearsExperienceApprox,
    targetFamilies,
    statedInterests: {
      targetRoles,
      adjacentRoles: [],
      targetIndustries: [],
    },
    locationPreference: inferLocationPreference(
      targetLocations,
      preferredLocations
    ),
    constraints: {
      hardNoSales: /\bcommission|commission-only|cold calling|cold outreach\b/i.test(
        toText(body.hard_nos)
      ),
      prefFullTime: /full[\s-]*time/i.test(toText(body.job_type)),
      hardNoContract: /\bcontract\b/i.test(toText(body.hard_nos)),
      hardNoHourlyPay: /\bhourly\b/i.test(toText(body.hard_nos)),
      hardNoGovernment: /\bgovernment\b/i.test(toText(body.hard_nos)),
      hardNoFullyRemote: /\bfully remote\b/i.test(toText(body.hard_nos)),
      preferNotAnalyticsHeavy: /\bnot analytics-heavy\b/i.test(
        toText(body.constraints)
      ),
    },
    intakeMeta: {
      currentStatus: toText(body.current_status) || null,
      university: toText(body.university) || null,
      major: toText(body.major) || null,
      timeline: toText(body.timeline) || null,
    },
  }
}

function getBearer(req: Request) {
  const h = req.headers.get("authorization") || ""
  const m = h.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : ""
}

async function resolveProfileIdentity(req: Request) {
  let authed: any = null
  try {
    authed = await getAuthedProfileText(req)
  } catch {
    // fall through
  }

  const profile =
    authed?.profile ||
    authed?.client_profile ||
    authed?.clientProfile ||
    authed?.client_profiles ||
    authed?.clientProfiles ||
    null

  let client_profile_id =
    profile?.id ||
    authed?.client_profile_id ||
    authed?.clientProfileId ||
    authed?.profile_id ||
    null

  let user_id =
    profile?.user_id ||
    authed?.user_id ||
    authed?.userId ||
    authed?.user?.id ||
    authed?.user?.user?.id ||
    null

  let email =
    profile?.email ||
    authed?.email ||
    authed?.user?.email ||
    authed?.user?.user?.email ||
    null

  if (!user_id || !email) {
    const token = getBearer(req)
    if (token) {
      const { data, error } = await supabaseAdmin.auth.getUser(token)
      if (!error && data?.user) {
        user_id = user_id || data.user.id
        email = email || data.user.email
      }
    }
  }

  if (user_id && !client_profile_id) {
    const { data, error } = await supabaseAdmin
      .from("client_profiles")
      .select("id, user_id, email")
      .eq("user_id", user_id)
      .single()

    if (!error && data?.id) {
      client_profile_id = data.id
      email = email || data.email
    }
  }

  if (email && !client_profile_id) {
    const { data, error } = await supabaseAdmin
      .from("client_profiles")
      .select("id, user_id, email")
      .eq("email", email)
      .single()

    if (!error && data?.id) {
      client_profile_id = data.id
      user_id = user_id || data.user_id
    }
  }

  return { client_profile_id, user_id, email }
}

// ---------- Route ----------
export async function POST(req: Request) {
  try {
    const { client_profile_id, user_id, email } = await resolveProfileIdentity(req)

    if (!client_profile_id || !user_id || !email) {
      return withCorsJson(
        req,
        {
          ok: false,
          error: "auth_profile_missing",
          detail: { client_profile_id, user_id, email },
        },
        500
      )
    }

    const body = (await req.json().catch(() => ({}))) as IntakeBody

    // Required fields for clean intake
    const resume_text = clampText(body.resume_text, 120000)
    const target_roles = clampText(body.target_roles, 4000)
    const job_type = clampText(body.job_type, 200)

    const missing: string[] = []
    if (!resume_text) missing.push("resume_text")
    if (!target_roles) missing.push("target_roles")
    if (!job_type) missing.push("job_type")

    if (missing.length) {
      return withCorsJson(
        req,
        {
          ok: false,
          error: "missing_required_fields",
          required: missing,
        },
        400
      )
    }

    const name = clampText(body.name, 200)
    const current_status = clampText(body.current_status, 200)
    const university = clampText(body.university, 300)
    const major = clampText(body.major, 300)
    const grad_year = clampText(body.grad_year, 20)

    const target_locations = clampText(body.target_locations, 4000)
    const preferred_locations = clampText(body.preferred_locations, 4000)
    const timeline = clampText(body.timeline, 200)

    const strong_skills = clampText(body.strong_skills, 4000)
    const biggest_concern = clampText(body.biggest_concern, 4000)
    const entry_openness = clampText(body.entry_openness, 200)
    const hard_nos = clampText(body.hard_nos, 4000)
    const constraints = clampText(body.constraints, 4000)

    const writing_samples = clampText(body.writing_samples, 60000)
    const extra_context = clampText(body.extra_context, 20000)

    const risk_overrides =
      body.risk_overrides && typeof body.risk_overrides === "object"
        ? body.risk_overrides
        : {}

    const canonicalProfileText = buildCanonicalProfileText({
      name,
      current_status,
      university,
      major,
      grad_year,

      job_type,
      target_roles,
      target_locations,
      preferred_locations,
      timeline,

      strong_skills,
      biggest_concern,
      entry_openness,
      hard_nos,
      constraints,

      resume_text,
      writing_samples,
      extra_context,
      risk_overrides,
    })

    const profile_structured = buildProfileStructuredForJobFit({
      name,
      current_status,
      university,
      major,
      grad_year,

      job_type,
      target_roles,
      target_locations,
      preferred_locations,
      timeline,

      strong_skills,
      biggest_concern,
      entry_openness,
      hard_nos,
      constraints,

      resume_text,
      writing_samples,
      extra_context,
      risk_overrides,
    })

    const { error: upErr } = await supabaseAdmin
      .from("client_profiles")
      .update({
        name: name || null,
        job_type: job_type || null,
        target_roles: target_roles || null,
        target_locations: target_locations || null,
        preferred_locations: preferred_locations || null,
        timeline: timeline || null,
        profile_text: canonicalProfileText,
        resume_text: resume_text || null,
        risk_overrides,
        profile_structured,
        updated_at: new Date().toISOString(),
      })
      .eq("id", client_profile_id)
      .eq("user_id", user_id)

    if (upErr) {
      return withCorsJson(req, { ok: false, error: upErr.message }, 400)
    }

    // Auto-create a default persona if none exists yet
    const { count: personaCount } = await supabaseAdmin
      .from("client_personas")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", client_profile_id)

    if (!personaCount) {
      const personaName = name || "Default"
      // Extract just the resume portion — the intake form may send the
      // full profile blob as resume_text.  The canonical profile_text
      // has a labelled "Resume Text:" section we can slice from.
      let personaResume = resume_text || ""
      const resumeMarker = canonicalProfileText.match(/\nResume:\s*/i)
      if (resumeMarker && resumeMarker.index != null) {
        const afterMarker = canonicalProfileText
          .slice(resumeMarker.index + resumeMarker[0].length)
          .replace(/\n(Writing samples|Extra context):\s*/i, (m: string) => "\0" + m)
          .split("\0")[0]
          .trim()
        if (afterMarker.length > 50) personaResume = afterMarker
      }
      await supabaseAdmin
        .from("client_personas")
        .insert({
          profile_id: client_profile_id,
          name: personaName,
          resume_text: personaResume,
          is_default: true,
          display_order: 1,
        })
    }

    return withCorsJson(
      req,
      {
        ok: true,
        client_profile_id,
        saved: {
          email,
          has_resume_text: Boolean(resume_text),
          target_roles_count: splitList(target_roles, 20).length,
          profile_text_len: canonicalProfileText.length,
          tools_count: Array.isArray(profile_structured.tools)
            ? profile_structured.tools.length
            : 0,
        },
      },
      200
    )
  } catch (err: any) {
    return withCorsJson(
      req,
      { ok: false, error: err?.message || "server_error" },
      500
    )
  }
}