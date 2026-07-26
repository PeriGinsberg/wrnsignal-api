// FILE: app/api/jobfit/resumeExtraction.ts
//
// LLM résumé-extraction schema + the SPAN-GROUNDING VERIFIER (deterministic).
// See DESIGN-resume-extractor.md. This module holds the raw LLM output shape and
// the anti-hallucination floor: every LLM fact must cite a verbatim résumé
// substring, or it is DROPPED. Built and tested standalone before anything
// depends on it — the LLM cannot manufacture evidence the text doesn't contain.

// ── Raw LLM extraction shape (JD-independent; every fact carries a span) ──────

export type RawBullet = {
  text: string
  leadingVerb: string | null
  verbClass: "ownership" | "contribution" | "neutral"
  objectPhrase: string
  objectHeadNoun: string | null
  scope: "function" | "task" | "unknown"
  tools: string[] // tool ids evidenced in THIS (experience) bullet
  metrics: string[] // revenue-metric tokens evidenced in this bullet
  grounding_span: string // verbatim bullet text
}

export type RawRole = {
  title: string
  company: string
  startYear: number | null
  endYear: number | null // null = present
  domains: string[] // CONTROLLED-vocab slugs (industry + practice, e.g. ["b2b_saas","ml_in_prod"])
  grounding_span: string // verbatim role header / date line
  bullets: RawBullet[]
}

export type RawSkill = {
  name: string // tool/skill id
  location: "experience" | "skills-only"
  version?: number
  grounding_span: string // verbatim span naming the skill
}

export type RawCredentialClaim = { id: string; grounding_span: string }
export type RawBoolClaim = { value: boolean; grounding_span: string }

export type RawCredentials = {
  degree?: RawBoolClaim // value:true = holds a degree (must be grounded)
  citizenship?: RawBoolClaim
  waiverOnFile?: RawBoolClaim
  clearancesHeld: RawCredentialClaim[]
  licensesHeld: RawCredentialClaim[]
}

export type RawResumeExtraction = {
  roles: RawRole[]
  skills: RawSkill[] // used for skillRecency (version); tool PRESENCE comes from a deterministic scan
  skillsSpan?: string // verbatim SKILLS section text (grounded) — scanned deterministically for tools
  credentials: RawCredentials
  managementBullets: { grounding_span: string; peopleNoun: string }[] // led/hired/grew people
}

// ── The span-grounding primitives ────────────────────────────────────────────

// Normalize for comparison: lowercase, unify dash variants (§5a), strip markdown
// bold, collapse whitespace. These changes never alter meaning, so a real span
// survives reformatting; a fabricated span (words not in the résumé) does not.
export function normalizeForGrounding(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‐‑‒–—―]/g, "-") // ‐ ‑ ‒ – — ―  → -
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

// (1) Presence: the cited span is a verbatim (normalized) substring of the résumé.
export function spanPresent(span: string, resumeNorm: string): boolean {
  const s = normalizeForGrounding(span)
  return s.length > 0 && resumeNorm.includes(s)
}

// (2) Relevance: the cited span actually contains the fact's own value — so a
// hallucinated tool can't be grounded with an unrelated real span.
export function spanContainsValue(span: string, value: string): boolean {
  const v = normalizeForGrounding(value)
  return v.length > 0 && normalizeForGrounding(span).includes(v)
}

// ── The verifier: drop every ungrounded fact, report what was dropped ─────────

export type GroundingReport = { verified: RawResumeExtraction; dropped: string[] }

export function verifyGrounding(raw: RawResumeExtraction, resumeText: string): GroundingReport {
  const resumeNorm = normalizeForGrounding(resumeText)
  const dropped: string[] = []
  const drop = (what: string) => (dropped.push(what), false)
  // Defensive: the LLM may omit arrays. Default them so a partial extraction
  // degrades gracefully instead of throwing (the dispatcher also try/catches).
  const cred = raw.credentials ?? ({ clearancesHeld: [], licensesHeld: [] } as RawCredentials)

  const roles: RawRole[] = (raw.roles ?? [])
    .filter((r) => (spanPresent(r.grounding_span, resumeNorm) ? true : drop(`role "${r.title} @ ${r.company}" — span not in résumé`)))
    .map((r) => ({
      ...r,
      bullets: (r.bullets ?? [])
        .filter((b) => (spanPresent(b.grounding_span, resumeNorm) ? true : drop(`bullet "${b.text.slice(0, 40)}…" — span not in résumé`)))
        .map((b) => ({
          ...b,
          // tools/metrics must appear inside the (already grounded) bullet span
          tools: (b.tools ?? []).filter((t) => (spanContainsValue(b.grounding_span, t) ? true : drop(`tool "${t}" — not in its bullet span`))),
          metrics: (b.metrics ?? []).filter((m) => (spanContainsValue(b.grounding_span, m) ? true : drop(`metric "${m}" — not in its bullet span`))),
        })),
    }))

  const skills: RawSkill[] = (raw.skills ?? []).filter((s) => {
    if (!spanPresent(s.grounding_span, resumeNorm)) return drop(`skill "${s.name}" — span not in résumé`)
    if (!spanContainsValue(s.grounding_span, s.name)) return drop(`skill "${s.name}" — span does not name it`)
    return true
  })

  const clearancesHeld = (cred.clearancesHeld ?? []).filter((c) =>
    spanPresent(c.grounding_span, resumeNorm) && spanContainsValue(c.grounding_span, "clearance")
      ? true
      : drop(`clearance "${c.id}" — ungrounded (span absent or not a clearance mention)`)
  )
  const licensesHeld = (cred.licensesHeld ?? []).filter((c) =>
    spanPresent(c.grounding_span, resumeNorm) ? true : drop(`license "${c.id}" — span not in résumé`)
  )

  // Boolean CLAIM guards: a positive credential claim (held/citizen) is a
  // CLEAR-direction fact (avoids hard_credential_absent), so it must be grounded;
  // an ungrounded positive claim is dropped → conservative default fires.
  const verifyBool = (claim: RawBoolClaim | undefined, kw: string, label: string): RawBoolClaim | undefined => {
    if (!claim) return undefined
    if (claim.value === true && !(spanPresent(claim.grounding_span, resumeNorm) && spanContainsValue(claim.grounding_span, kw))) {
      drop(`${label}=true — ungrounded, dropped to unknown`)
      return undefined
    }
    return spanPresent(claim.grounding_span, resumeNorm) ? claim : (drop(`${label} — span not in résumé`), undefined)
  }

  const managementBullets = (raw.managementBullets ?? []).filter((m) =>
    spanPresent(m.grounding_span, resumeNorm) ? true : drop(`management bullet — span not in résumé`)
  )

  const skillsSpan = raw.skillsSpan && spanPresent(raw.skillsSpan, resumeNorm) ? raw.skillsSpan : undefined
  if (raw.skillsSpan && !skillsSpan) drop("skillsSpan — not in résumé")

  return {
    verified: {
      roles,
      skills,
      skillsSpan,
      credentials: {
        degree: verifyBool(cred.degree, "degree", "degree"),
        citizenship: verifyBool(cred.citizenship, "citizen", "citizenship"),
        waiverOnFile: verifyBool(cred.waiverOnFile, "waiver", "waiverOnFile"),
        clearancesHeld,
        licensesHeld,
      },
      managementBullets,
    },
    dropped,
  }
}
