// FILE: app/api/jobfit/llmResumeExtractor.ts
//
// LLM résumé extractor (step 2). Produces the SAME shapes the deterministic
// detectors consume — ProfileEvidence + VerbBullet[] — from a span-grounded LLM
// read. Three vetoes on the CLEAR direction: (1) the step-1 span-grounding floor,
// (2) a contribution-verb denylist (can't be laundered to ownership), (3) a
// task-noun denylist (can't be laundered to function scope). See
// DESIGN-resume-extractor.md. Dispatcher fails open to the regex extractors.

import type { ProfileEvidence } from "./gateLedger"
import type { VerbBullet, VerbClass, BulletScope } from "./verbEvidence"
import { extractProfileEvidence } from "./profileEvidence"
import { extractVerbEvidence } from "./verbEvidence"
import {
  verifyGrounding, normalizeForGrounding,
  type RawResumeExtraction, type RawBullet, type RawRole,
} from "./resumeExtraction"

const CURRENT_YEAR = 2026

// ── The two clear-direction denylists (deterministic overrides) ───────────────
// The LLM may NOT classify these contribution verbs as ownership.
const CONTRIBUTION_VERB_DENYLIST = new Set([
  "partnered", "supported", "assisted", "contributed", "helped", "collaborated",
  "participated", "aided", "gathered",
])
// The LLM may NOT label these task nouns as function scope.
const TASK_NOUN_DENYLIST = ["report", "reports", "reporting", "dashboard", "dashboards", "taxonomy", "deck", "readout", "readouts", "presentation", "spreadsheet"]

// A function noun present alongside a task noun keeps function scope (e.g. "the
// data platform's dashboards" is still platform-level).
const FUNCTION_NOUN_HINT = ["system", "platform", "stack", "warehouse", "infrastructure", "function", "model", "pipeline", "roadmap", "strategy", "org", "line"]

// Defect 1 — a function-scope QUALIFIER: organizational/strategic BREADTH that
// makes a task-noun deliverable ("reporting") a FUNCTION-level one ("the reporting
// function, across fund strategies / for institutional portfolios"). Deliberately
// TIGHT — matches genuine breadth (strategies / portfolios / business units /
// divisions / entities / "the X function" / firm-wide) but NOT loose phrases that
// sit on ordinary task bullets ("for clients", "across teams", "for the project",
// "across Meta/Google/networks"). A missed upgrade is safe (stays task); a loose
// upgrade would false-clear a faker. See project_jobfit_ownership_reporting_scope_falsefire.
const FUNCTION_QUALIFIER_RX =
  /\b(?:across|spanning|for|over)\s+(?:[a-z]+\s+){0,2}(?:strateg(?:y|ies)|portfolios?|business\s+units?|business\s+lines?|lines?\s+of\s+business|asset\s+classes|divisions?|entit(?:y|ies))\b|\bthe\s+[a-z]+\s+function\b|\bthe\s+(?:firm|organi[sz]ation|org|company|enterprise|business)\b|\b(?:firm|company|org(?:anization)?|enterprise)[-\s]wide\b/i

// Which noun classes appear in an object phrase (word-boundary matched).
function objectNouns(objectPhrase: string): { hasFn: boolean; hasTask: boolean } {
  const o = normalizeForGrounding(objectPhrase)
  return {
    hasFn: FUNCTION_NOUN_HINT.some((n) => new RegExp(`\\b${n}\\b`).test(o)),
    hasTask: TASK_NOUN_DENYLIST.some((n) => new RegExp(`\\b${n}\\b`).test(o)),
  }
}

// Apply denylists to a (already grounding-verified) extraction. Only downgrades.
export function applyDenylists(raw: RawResumeExtraction): { raw: RawResumeExtraction; overrides: string[] } {
  const overrides: string[] = []
  const roles = (raw.roles ?? []).map((r) => ({
    ...r,
    bullets: r.bullets.map((b) => {
      let verbClass = b.verbClass
      let scope = b.scope
      if (verbClass === "ownership" && b.leadingVerb && CONTRIBUTION_VERB_DENYLIST.has(b.leadingVerb.toLowerCase())) {
        overrides.push(`verb "${b.leadingVerb}" ownership→contribution (denylist)`)
        verbClass = "contribution"
      }
      // Deterministic scope decision (the LLM segments; the clear-direction calls
      // are ours). DOWNGRADE: a task noun with no function signal demotes an
      // over-claimed function. UPGRADE (Fix B): a function noun in the object
      // promotes an under-claimed task ("the rollout of a marketing mix model").
      // UPGRADE (Defect 1): a function-scope QUALIFIER on an OWNERSHIP bullet
      // credits a task-noun deliverable as function-level ("Built reporting across
      // fund strategies"). Verb-gated to ownership so it only adds CLEARING power
      // for genuine owners — a contribution bullet ("Supported reporting across
      // fund strategies") is NEVER upgraded, so it can't false-trigger or clear.
      const { hasFn, hasTask } = objectNouns(b.objectPhrase)
      const ownQualifier = verbClass === "ownership" && FUNCTION_QUALIFIER_RX.test(b.text)
      if (scope === "function" && hasTask && !hasFn && !ownQualifier) {
        overrides.push(`object "${b.objectPhrase.slice(0, 30)}" function→task (denylist)`)
        scope = "task"
      } else if (scope === "task" && ((hasFn && !hasTask) || ownQualifier)) {
        overrides.push(`object "${b.objectPhrase.slice(0, 30)}" task→function (${ownQualifier ? "ownership+qualifier" : "function-noun"} upgrade)`)
        scope = "function"
      }
      return { ...b, verbClass, scope }
    }),
  }))
  return { raw: { ...raw, roles }, overrides }
}

// ── Adapters: verified RawResumeExtraction → the seam shapes ──────────────────

function slug(s: string): string {
  return s.trim().toLowerCase().replace(/\+/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

// ── Controlled vocabulary (A) + thin synonym safety-net (B) ───────────────────
// The extractor must emit ONLY these slugs, aligned to the gate/detector slugs.
// Anything outside the vocab is DROPPED (not freelanced). The synonym map is a
// thin SAFETY NET (a §6-style fitted surface — real-corpus hardened later, kept
// small, normalize/downgrade only).
const DOMAIN_VOCAB = new Set(["b2b_saas", "consumer", "ml_in_prod", "fintech", "healthtech", "ecommerce", "enterprise_software", "government", "education", "media", "other"])
// Tool vocab aligned EXACTLY to the gate/detector tool slugs (= regex TOOL_TOKENS).
const TOOL_VOCAB = new Set(["dbt", "snowflake", "airflow", "spark", "salesforce", "hubspot", "angular", "pytorch", "tensorflow", "tableau", "looker", "ab_testing"])
const SYNONYM: Record<string, string> = {
  saas: "b2b_saas", b2b: "b2b_saas", software_as_a_service: "b2b_saas",
  a_b_testing: "ab_testing", ab_test: "ab_testing", ab_tests: "ab_testing", experimentation: "ab_testing",
}
function normDomain(raw: string): string | null {
  const s = slug(raw)
  const m = SYNONYM[s] ?? s
  return DOMAIN_VOCAB.has(m) ? m : null
}
function normTool(raw: string): string | null {
  const s = slug(raw)
  const m = SYNONYM[s] ?? s
  return TOOL_VOCAB.has(m) ? m : null
}

// Deterministic, grounded tool scan (over LLM-segmented text). The LLM provides
// SEGMENTATION (which text is experience vs the skills section); tool presence is
// scanned deterministically here — robust to the LLM under/over-tagging tools,
// and matches the regex extractor's own scan.
const TOOL_PHRASES: Array<[RegExp, string]> = [
  [/\bdbt\b/, "dbt"], [/\bsnowflake\b/, "snowflake"], [/\bairflow\b/, "airflow"], [/\bspark\b/, "spark"],
  [/\bsalesforce\b/, "salesforce"], [/\bhubspot\b/, "hubspot"], [/\bangular\b/, "angular"],
  [/\bpytorch\b/, "pytorch"], [/\btensorflow\b/, "tensorflow"], [/\btableau\b/, "tableau"], [/\blooker\b/, "looker"],
  [/a\/b testing|\bab testing\b|experimentation/, "ab_testing"],
]
function scanTools(text: string): Set<string> {
  const t = normalizeForGrounding(text)
  const out = new Set<string>()
  for (const [re, s] of TOOL_PHRASES) if (re.test(t)) out.add(s)
  return out
}

export function rawToVerbBullets(raw: RawResumeExtraction): VerbBullet[] {
  const out: VerbBullet[] = []
  for (const r of raw.roles ?? []) {
    for (const b of r.bullets ?? []) {
      out.push({
        text: b.text,
        leadingVerb: b.leadingVerb ? b.leadingVerb.toLowerCase() : null,
        verbClass: b.verbClass as VerbClass,
        objectPhrase: b.objectPhrase,
        objectHeadNoun: b.objectHeadNoun,
        scope: b.scope as BulletScope,
      })
    }
  }
  return out
}

// Fix 1 — genuine-SaaS floor. The b2b_saas slug tags ONLY a software/product
// company (builds/sells software), never any enterprise/corporate employer.
// Kept when the role text shows an explicit SaaS/software signal (Loomtree states
// "B2B SaaS"; a "Software Engineer" role) OR software-building work (React/deploy/
// backend). Un-tags finance/insurance/services employers the LLM over-tagged
// (AWAC insurance, Watson relocation); keeps real SaaS (Teladoc, Loomtree).
const SAAS_EMPLOYER_SIGNAL = /\bsaas\b|\bsoftware\b|software-as-a-service/
const SOFTWARE_BUILD_SIGNAL = /\b(react|node\.?js|typescript|angular|ruby on rails|docker|kubernetes|microservices?|graphql|full-?stack|back-?end|front-?end|api endpoints?|sdk)\b/
function roleSupportsSaas(r: RawRole): boolean {
  const txt = normalizeForGrounding([r.grounding_span, ...(r.bullets ?? []).map((b) => b.grounding_span)].join(" "))
  return SAAS_EMPLOYER_SIGNAL.test(txt) || SOFTWARE_BUILD_SIGNAL.test(txt)
}
// Effective (vocab-normalized, SaaS-floored) domains for a role.
function effectiveDomains(r: RawRole): string[] {
  const out: string[] = []
  for (const raw of r.domains ?? []) {
    const d = normDomain(raw)
    if (!d) continue // outside controlled vocab → dropped, not freelanced
    if (d === "b2b_saas" && !roleSupportsSaas(r)) continue // Fix 1 floor
    out.push(d)
  }
  return out
}

export function rawToProfileEvidence(raw: RawResumeExtraction): ProfileEvidence {
  const cred = raw.credentials ?? { clearancesHeld: [], licensesHeld: [] }
  // Roles most-recent-first for recency indices.
  const roles = [...(raw.roles ?? [])].sort((a, b) => (b.startYear ?? 0) - (a.startYear ?? 0))
  const roleYears = (r: RawResumeExtraction["roles"][number]) => Math.max(0, (r.endYear ?? CURRENT_YEAR) - (r.startYear ?? CURRENT_YEAR))

  const domainYears: Record<string, number> = {}
  for (const r of roles) {
    for (const d of effectiveDomains(r)) {
      domainYears[d] = (domainYears[d] ?? 0) + roleYears(r)
    }
  }
  // Domains of the MOST-RECENT role — the recency exemption for fix 2's
  // years-aware domain_gap (a junior CURRENTLY in the domain isn't "missing" it).
  const currentDomains = roles.length ? effectiveDomains(roles[0]) : []

  // Tools: deterministic grounded scan over the LLM's segmentation. Experience =
  // all bullet spans; skills-only = the skills-section span minus experience.
  const experienceText = roles.flatMap((r) => (r.bullets ?? []).map((b) => b.grounding_span)).join(" \n ")
  const expTools = scanTools(experienceText)
  const skillTools = raw.skillsSpan ? scanTools(raw.skillsSpan) : new Set<string>()
  const toolsInExperience = Array.from(expTools)
  const toolsInSkillsOnly = Array.from(skillTools).filter((t) => !expTools.has(t))

  // recency: deterministic version-scan over the LLM's role segmentation
  // (most-recent role first). A tool tracked only when it appears WITH a version
  // number (e.g. "Angular 2–5" → 5) — mirrors the regex extractor.
  const skillRecency: ProfileEvidence["skillRecency"] = {}
  for (const [, tool] of TOOL_PHRASES) {
    if (skillRecency[tool]) continue
    for (let idx = 0; idx < roles.length; idx++) {
      const text = normalizeForGrounding((roles[idx].bullets ?? []).map((b) => b.grounding_span).join(" "))
      const vm = text.match(new RegExp(`\\b${tool.replace(/_/g, " ")}\\s*(?:js)?\\s*(\\d+)(?:\\s*-\\s*(\\d+))?`))
      if (vm) {
        skillRecency[tool] = { lastUsedRoleIndex: idx, version: Math.max(Number(vm[1]), vm[2] ? Number(vm[2]) : Number(vm[1])) }
        break
      }
    }
  }

  const mgr = (raw.managementBullets ?? []).some((m) => /manager/i.test(m.peopleNoun))
  return {
    totalYears: roles.length ? roles.reduce((s, r) => s + roleYears(r), 0) : null,
    domainYears,
    currentDomains,
    managerOfManagersYears: mgr ? 5 : 0,
    toolsInExperience,
    toolsInSkillsOnly,
    licensesHeld: (cred.licensesHeld ?? []).map((c) => slug(c.id)),
    clearancesHeld: (cred.clearancesHeld ?? []).map((c) => slug(c.id)),
    citizenshipStated: cred.citizenship?.value ?? null,
    // Fix A: derive from PRESENCE of a grounded degree claim, not its value —
    // the LLM emits `value` as the degree NAME ("BS, …"), not a boolean, so a
    // real degree read UNKNOWN (never MET). A grounded claim ⇒ degree present ⇒
    // true; absent ⇒ false (résumés list degrees; mirrors regex's UNMET). An
    // explicit value:false (rare) stays false.
    degreeHeld: cred.degree ? cred.degree.value !== false : false,
    waiverOnFile: cred.waiverOnFile?.value ?? false,
    skillRecency,
  }
}

// ── LLM call + résumé-keyed cache (determinism plumbing finished in step 3) ───

export type ResumeExtractCache = Record<string, RawResumeExtraction>

function hashKey(s: string): string {
  let h = 0
  const n = normalizeForGrounding(s)
  for (let i = 0; i < n.length; i++) { h = (h * 31 + n.charCodeAt(i)) | 0 }
  return "re_" + (h >>> 0).toString(36)
}

// Live Haiku call. Fails OPEN to null on any error (no key / HTTP / parse).
async function callResumeExtractionLive(resumeText: string): Promise<RawResumeExtraction | null> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4096,
        temperature: 0,
        system: RESUME_EXTRACT_SYSTEM,
        messages: [{ role: "user", content: resumeText }],
      }),
    })
    if (!res.ok) return null
    const data: any = await res.json()
    const text = data?.content?.[0]?.text
    if (typeof text !== "string") return null
    const jsonStart = text.indexOf("{")
    const jsonEnd = text.lastIndexOf("}")
    if (jsonStart < 0 || jsonEnd < 0) return null
    return JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as RawResumeExtraction
  } catch {
    return null
  }
}

const RESUME_EXTRACT_SYSTEM =
  "Extract structured facts from the résumé as JSON matching RawResumeExtraction " +
  "{roles[{title,company,startYear,endYear|null,domains[],grounding_span,bullets[{text,leadingVerb,verbClass(ownership|contribution|neutral),objectPhrase,objectHeadNoun,scope(function|task|unknown),tools[],metrics[],grounding_span}]}],skills[{name,location(experience|skills-only),version?,grounding_span}],skillsSpan(verbatim SKILLS section text),credentials{degree?{value,grounding_span},citizenship?{value,grounding_span},waiverOnFile?{value,grounding_span},clearancesHeld[{id,grounding_span}],licensesHeld[{id,grounding_span}]},managementBullets[{grounding_span,peopleNoun}]}. " +
  "skillsSpan = the verbatim text of the résumé's SKILLS/TECHNICAL SKILLS section (copied exactly). " +
  "CONTROLLED VOCABULARY — emit ONLY these slugs; if a fact maps to none, OMIT it (do NOT invent a new slug). " +
  "roles[].domains ⊆ {b2b_saas, consumer, ml_in_prod, fintech, healthtech, ecommerce, enterprise_software, government, education, media, other}. " +
  "Include BOTH the industry AND practice-domains: tag ml_in_prod for building/shipping ML models in production; tag b2b_saas for B2B SaaS / enterprise-software companies. " +
  "tools[] and skills[].name ⊆ {dbt, snowflake, airflow, spark, salesforce, hubspot, angular, angularjs, pytorch, tensorflow, tableau, looker, kafka, ab_testing}. " +
  "Tag A/B testing or experimentation work as ab_testing. Put a tool in a bullet's tools[] (experience) if used in that role; in skills[] with location=skills-only if only listed. " +
  "EVERY grounding_span MUST be a verbatim substring copied from the résumé. Never invent facts. When uncertain, omit. Output JSON only."

async function getRawExtraction(resumeText: string, cache: ResumeExtractCache, allowLive: boolean): Promise<RawResumeExtraction | null> {
  const key = hashKey(resumeText)
  if (cache[key]) return cache[key]
  if (!allowLive) return null // fail-open: cache miss, live disabled → caller uses regex
  const raw = await callResumeExtractionLive(resumeText)
  if (raw) cache[key] = raw
  return raw
}

// ── Dispatcher: LLM (verified + denylisted) when available, else regex ────────
export type ResumeEvidence = { profileEvidence: ProfileEvidence; verbBullets: VerbBullet[]; source: "llm" | "regex" }

export async function resolveResumeEvidence(
  resumeText: string,
  opts?: { llm?: { cache: ResumeExtractCache; allowLive: boolean }; onDrop?: (msgs: string[]) => void }
): Promise<ResumeEvidence> {
  if (opts?.llm) {
    try {
      const raw = await getRawExtraction(resumeText, opts.llm.cache, opts.llm.allowLive)
      if (raw) {
        const { verified, dropped } = verifyGrounding(raw, resumeText) // veto 1: span grounding
        const { raw: deny, overrides } = applyDenylists(verified) // vetoes 2 + 3
        opts.onDrop?.([...dropped, ...overrides])
        return { profileEvidence: rawToProfileEvidence(deny), verbBullets: rawToVerbBullets(deny), source: "llm" }
      }
    } catch {
      // ANY failure in the LLM path (malformed output, adapter throw) → fail open
      // to regex. The LLM read must never be a hard dependency of the scan.
    }
  }
  // fail-open: regex extractors (unchanged, deterministic)
  return { profileEvidence: extractProfileEvidence(resumeText), verbBullets: extractVerbEvidence(resumeText), source: "regex" }
}
