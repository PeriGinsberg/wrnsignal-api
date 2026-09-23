// lib/network-tracker/import-resolve.ts
// The rules for a contacts import, as a pure function: parsed rows plus the
// board's current state go in, a disposition per row and a plan per company
// come out. Nothing here touches Supabase, which is what lets every rule be
// tested without a database and what lets the preview and the commit share one
// implementation instead of two that agree until they don't.
//
// See docs/network-tracker/coach-contacts-import.md.

export type Disposition =
  | "create"
  | "skip_duplicate_email"
  | "skip_duplicate_name"
  | "skip_conflict"
  | "skip_invalid"

/** A company as it exists on the board today. */
export type ExistingCompany = { id: string; name: string; domain: string | null }
/** A contact as it exists on the board today. */
export type ExistingContact = {
  first_name: string
  last_name: string
  company_id: string | null
  email: string | null
}

/** One spreadsheet row, already mapped to fields and trimmed. */
export type SourceRow = {
  rowNum: number // 1-based spreadsheet row, for talking to a human
  company: string
  first: string
  last: string
  title: string
  email: string
  linkedin: string
  domain: string
  // Optional columns. A client importing their own spreadsheet may map these;
  // the coach workbook has none of them, which is why the defaults below exist.
  segment: string
  priority: string
  relationship: string
  additionalInfo: string
}

// Only these reach the column; anything else is left blank rather than guessed.
const RELATIONSHIPS = new Set(["personal", "affinity", "referred", "cold", "recruiter"])
const PRIORITIES = new Set(["A", "B", "C"])

/** The locked default when a file does not say. */
export const DEFAULT_RELATIONSHIP = "cold"

/** How a row's company was resolved. `ref` is an existing id, or `new:<key>`
 *  for a company this import will create — commit swaps it for the real id. */
export type CompanyAction = "none" | "match_domain" | "match_name" | "create"

export type CompanyPlan = {
  key: string // `new:<k>` correlation key
  name: string
  domain: string | null
}

/** A company matched by name that has no domain yet, and the domain to write. */
export type DomainBackfill = { id: string; name: string; domain: string }

export type ResolvedRow = {
  rowNum: number
  disposition: Disposition
  display: string // "Jon Britt"
  companyName: string
  companyAction: CompanyAction
  companyRef: string | null // existing id, or `new:<key>`
  emailDropped: boolean // created, but the Email cell was not an address
  detail: string | null // why it was skipped, in a sentence
  // Text that was in the Email cell but is not an address ("call her", a phone
  // number). Kept so commit can log it against the contact instead of losing it.
  contactMethod: string | null
  // Only present on `create`, and only consumed by commit.
  insert?: {
    first_name: string
    last_name: string
    title: string | null
    email: string | null
    linkedin_url: string | null
    company_domain: string | null
    segment: string | null
    priority: string | null
    relationship: string
    additional_info: string | null
  }
}

export type ResolveResult = {
  rows: ResolvedRow[]
  companiesToCreate: CompanyPlan[]
  domainBackfills: DomainBackfill[]
  summary: {
    total: number
    create: number
    skip_duplicate_email: number
    skip_duplicate_name: number
    skip_conflict: number
    skip_invalid: number
    emailDropped: number
    companiesMatched: number
    companiesCreated: number
    domainsBackfilled: number
  }
}

const lc = (s: string) => (s ?? "").trim().toLowerCase()

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((s ?? "").trim())

// Free-mail hosts never identify an employer. Matching companies on them would
// merge every contact who listed a personal address into one company.
const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "ymail.com", "icloud.com", "me.com", "mac.com", "aol.com",
  "proton.me", "protonmail.com", "gmx.com", "gmx.net", "mail.com", "zoho.com",
])

/**
 * A domain reduced to the thing worth comparing: no scheme, no `www.`, no path,
 * no port, no trailing dot, lowercased. Returns null for anything that is not
 * usable as a company identity, free-mail included.
 */
export function normalizeDomain(raw: string): string | null {
  let s = (raw ?? "").trim().toLowerCase()
  if (!s) return null
  // Accept a full URL, a bare host, or an email address.
  if (s.includes("@")) s = s.slice(s.lastIndexOf("@") + 1)
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "") // scheme
  s = s.split(/[/?#]/)[0] // path, query, fragment
  s = s.split(":")[0] // port
  s = s.replace(/^www\./, "").replace(/\.+$/, "")
  if (!s || !s.includes(".")) return null
  if (!/^[a-z0-9.-]+$/.test(s)) return null
  if (FREE_MAIL.has(s)) return null
  return s
}

/** The name we show a human for a row. */
export function displayFor(first: string, last: string): string {
  return [first.trim(), last.trim()].filter(Boolean).join(" ")
}

/**
 * Resolve a whole file at once.
 *
 * Order matters and is the order a human would use: work out which company the
 * row belongs to, then ask whether we already have the person. A row that
 * cannot name its company is not a contact we can place, so it is reported
 * rather than filed under a company invented from a hostname.
 */
export function resolveImport(args: {
  rows: SourceRow[]
  companies: ExistingCompany[]
  contacts: ExistingContact[]
}): ResolveResult {
  const { rows, companies, contacts } = args

  // ── existing state, indexed ──
  const byDomain = new Map<string, ExistingCompany>()
  const byName = new Map<string, ExistingCompany>()
  for (const c of companies) {
    const d = normalizeDomain(c.domain ?? "")
    if (d && !byDomain.has(d)) byDomain.set(d, c)
    byName.set(lc(c.name), c)
  }
  const existingEmails = new Map<string, ExistingContact>()
  const existingNameKeys = new Set<string>()
  for (const c of contacts) {
    if (c.email && isEmail(c.email)) existingEmails.set(lc(c.email), c)
    existingNameKeys.add(`${lc(c.first_name)}|${lc(c.last_name)}|${c.company_id ?? ""}`)
  }

  // ── within-batch state, so a file that repeats a person creates them once ──
  const plannedCompanies = new Map<string, CompanyPlan>() // key -> plan
  const plannedByDomain = new Map<string, string>() // domain -> key
  const plannedByName = new Map<string, string>() // lower(name) -> key
  const backfills = new Map<string, DomainBackfill>() // company id -> backfill
  const batchEmails = new Set<string>()
  const batchNameKeys = new Set<string>()

  const out: ResolvedRow[] = []
  let companiesMatched = 0

  for (const row of rows) {
    const first = row.first.trim()
    const last = row.last.trim()
    const display = displayFor(first, last)
    const companyName = row.company.trim()
    const domain = normalizeDomain(row.domain)

    const base = {
      rowNum: row.rowNum,
      display,
      companyName,
      companyAction: "none" as CompanyAction,
      companyRef: null as string | null,
      emailDropped: false,
      contactMethod: null as string | null,
      detail: null as string | null,
    }

    if (!display) {
      out.push({ ...base, disposition: "skip_invalid", detail: "No first or last name." })
      continue
    }

    // Decision: a domain with no company name is never enough to create a
    // company, because the only name available would be the hostname.
    if (!companyName && row.domain.trim()) {
      out.push({
        ...base,
        disposition: "skip_invalid",
        detail: `Domain "${row.domain.trim()}" with no company name.`,
      })
      continue
    }

    // ── company ──
    let companyAction: CompanyAction = "none"
    let companyRef: string | null = null

    if (companyName) {
      const hitDomain = domain ? byDomain.get(domain) : undefined
      const hitName = byName.get(lc(companyName))

      if (hitDomain && hitName && hitDomain.id !== hitName.id) {
        out.push({
          ...base,
          disposition: "skip_conflict",
          detail: `Domain ${domain} is "${hitDomain.name}" but the row says "${companyName}".`,
        })
        continue
      }

      if (hitDomain) {
        companyAction = "match_domain"
        companyRef = hitDomain.id
        companiesMatched++
      } else if (hitName) {
        companyAction = "match_name"
        companyRef = hitName.id
        companiesMatched++
        // One write to an existing row, reported on its own line.
        if (domain && !normalizeDomain(hitName.domain ?? "") && !backfills.has(hitName.id)) {
          backfills.set(hitName.id, { id: hitName.id, name: hitName.name, domain })
        }
      } else {
        // Not on the board. Has this file already planned it?
        const plannedKey =
          (domain ? plannedByDomain.get(domain) : undefined) ?? plannedByName.get(lc(companyName))
        if (plannedKey) {
          companyAction = "create"
          companyRef = plannedKey
          // A later row can supply the domain the first one lacked.
          const plan = plannedCompanies.get(plannedKey)!
          if (domain && !plan.domain) {
            plan.domain = domain
            plannedByDomain.set(domain, plannedKey)
          }
        } else {
          const key = `new:${plannedCompanies.size}`
          plannedCompanies.set(key, { key, name: companyName, domain })
          plannedByName.set(lc(companyName), key)
          if (domain) plannedByDomain.set(domain, key)
          companyAction = "create"
          companyRef = key
        }
      }
    }

    // ── contact ──
    const emailRaw = row.email.trim()
    const emailValid = emailRaw ? isEmail(emailRaw) : false
    const email = emailValid ? emailRaw : null

    if (email) {
      const key = lc(email)
      const already = existingEmails.get(key)
      if (already) {
        const elsewhere = already.company_id !== null && already.company_id !== companyRef
        out.push({
          ...base,
          companyAction,
          companyRef,
          disposition: "skip_duplicate_email",
          detail: elsewhere
            ? `${email} is already on the board under a different company.`
            : `${email} is already on the board.`,
        })
        continue
      }
      if (batchEmails.has(key)) {
        out.push({
          ...base,
          companyAction,
          companyRef,
          disposition: "skip_duplicate_email",
          detail: `${email} appears earlier in this file.`,
        })
        continue
      }
    }

    // Name + company, which is what the database's partial unique indexes use.
    // Checked even when an email matched nothing, because the same person can
    // be on the board with no email at all.
    const nameKey = `${lc(first)}|${lc(last)}|${companyRef ?? ""}`
    if (existingNameKeys.has(nameKey)) {
      out.push({
        ...base,
        companyAction,
        companyRef,
        disposition: "skip_duplicate_name",
        detail: companyName ? `${display} is already at ${companyName}.` : `${display} is already on the board.`,
      })
      continue
    }
    if (batchNameKeys.has(nameKey)) {
      out.push({
        ...base,
        companyAction,
        companyRef,
        disposition: "skip_duplicate_name",
        detail: `${display} appears earlier in this file.`,
      })
      continue
    }

    if (email) batchEmails.add(lc(email))
    batchNameKeys.add(nameKey)

    out.push({
      ...base,
      companyAction,
      companyRef,
      disposition: "create",
      emailDropped: Boolean(emailRaw) && !emailValid,
      contactMethod: emailRaw && !emailValid ? emailRaw : null,
      detail: emailRaw && !emailValid ? `"${emailRaw}" is not an email address; left blank.` : null,
      insert: {
        first_name: first,
        last_name: last,
        title: row.title.trim() || null,
        email,
        linkedin_url: row.linkedin.trim() || null,
        company_domain: row.domain.trim() || null,
        // Mapped when the file says so, locked default when it does not.
        segment: row.segment.trim() || null,
        priority: PRIORITIES.has(row.priority.trim().toUpperCase()) ? row.priority.trim().toUpperCase() : null,
        relationship: RELATIONSHIPS.has(lc(row.relationship)) ? lc(row.relationship) : DEFAULT_RELATIONSHIP,
        additional_info: row.additionalInfo.trim() || null,
      },
    })
  }

  const count = (d: Disposition) => out.filter((r) => r.disposition === d).length

  return {
    rows: out,
    companiesToCreate: [...plannedCompanies.values()],
    domainBackfills: [...backfills.values()],
    summary: {
      total: rows.length,
      create: count("create"),
      skip_duplicate_email: count("skip_duplicate_email"),
      skip_duplicate_name: count("skip_duplicate_name"),
      skip_conflict: count("skip_conflict"),
      skip_invalid: count("skip_invalid"),
      emailDropped: out.filter((r) => r.emailDropped).length,
      companiesMatched,
      companiesCreated: plannedCompanies.size,
      domainsBackfilled: backfills.size,
    },
  }
}
