/**
 * Which apply link a Google Jobs posting gets.
 *
 * Google lists several links per job: the employer's careers site, job boards,
 * and sites that republish other sites' postings, often as an AI-rewritten
 * teaser under a new title. A coach check of Alex's top 25 (2026-10-25) found
 * 9 links landing on such rewrites (Jobleads, Jobrapido, Jobmesh, Vaia), one
 * expired (Jobilize) and one behind a robot check (Career.com).
 *
 * ORDER, best first:
 *   employer   the employer's own site (its name in the host or source label)
 *              or an applicant tracking system (Greenhouse, Workday, iCIMS, ...)
 *   board      LinkedIn, Indeed, ZipRecruiter, Glassdoor, then other original
 *              job boards
 *   republisher a known republishing site, or one that needs an account to see
 *              the job (Handshake, school career portals), only when nothing
 *              above exists
 *   other      a host we do not recognise, last of all: across prod's SearchApi
 *              rows these were mostly more republishers, and some were spam
 *              (zigibugy.tattoo, idelakev.cam, a blogspot page)
 *   google     Google's own share link, when there is no link at all
 * The kind is stored as postings.apply_link_kind. republisher, other and google
 * all mean "no employer or board link": the queue's republished_only flag.
 *
 * ANOTHER EMPLOYER'S LINK (Lindsey's #7, 2026-10-27). Google can merge two
 * jobs with the same title: Avenue Z's "Content Marketing Intern" listed
 * Claim Health's Ashby board, and the ATS rule made it the employer link.
 * An ATS link whose readable account (host label or first path segment, by
 * ATS) names some other company ranks below the job boards; one whose address
 * names no account (Paylocity, Oracle) keeps its place. A LinkedIn
 * link whose address names another company ("...-at-the-clorox-company-...",
 * on a Capital One listing) ranks below every other link but Google's own.
 */

export type ApplyLinkKind = "employer" | "board" | "other" | "republisher" | "google"
export type ApplyLink = { url: string; kind: ApplyLinkKind }

const ATS = [
  "greenhouse.io", "lever.co", "myworkdayjobs.com", "myworkdaysite.com", "workday.com", "icims.com", "smartrecruiters.com",
  "jobvite.com", "ashbyhq.com", "paylocity.com", "ultipro.com", "ukg.net", "taleo.net", "oraclecloud.com",
  "successfactors.com", "successfactors.eu", "adp.com", "bamboohr.com", "workable.com", "breezy.hr", "recruitee.com",
  "applytojob.com", "dayforcehcm.com", "eightfold.ai", "avature.net", "phenompeople.com", "jazzhr.com",
  "paycomonline.net", "paycor.com", "rippling-ats.com", "teamtailor.com", "pinpointhq.com", "brassring.com",
]

/** Original job boards, in preference order: the first four by name, then the rest. */
const BOARDS = [
  "linkedin.com", "indeed.com", "ziprecruiter.com", "glassdoor.com",
  "monster.com", "careerbuilder.com", "simplyhired.com", "dice.com", "builtin.com", "wellfound.com",
  "efinancialcareers.com", "usajobs.gov", "idealist.org", "snagajob.com", "theladders.com",
  "higheredjobs.com", "hcareers.com", "themuse.com", "governmentjobs.com", "internships.com",
  "builtinchicago.org", "builtinnyc.com", "builtinboston.com", "builtinla.com", "builtinsf.com", "builtincolorado.com",
  "builtinaustin.com", "builtinseattle.com", "ihirefinance.com", "ihirebanking.com", "ihiresalespeople.com",
]

/**
 * Sites that republish other sites' postings, in three tiers from a browser
 * check of Alex's top 25 (2026-10-25):
 *   full copies first (Teal, Nexxt)
 *   every other republisher next, in Google's own order: rewritten teasers
 *     (Jobleads, Jobrapido, Jobmesh, Vaia) and ones not yet checked alike
 *   known-bad last: robot checks (Career.com, learn4good), expired listings (Jobilize)
 */
const REPUBLISHERS_FULL = ["tealhq.com", "nexxt.com"]
const REPUBLISHERS_BAD = ["career.com", "jobilize.com", "learn4good.com"]
/**
 * Sites that show the job only after signing up: Handshake (Lindsey's #1, #6,
 * #9, 2026-10-27) and school or campus career portals. Ranked as republishers,
 * after the full copies: a coach cannot open them, the client may not have an
 * account.
 */
const SIGNUP_REQUIRED = ["joinhandshake.com", "ripplematch.com", "wayup.com", "symplicity.com", "12twenty.com", "gradleaders.com", "jobteaser.com", "purplebriefcase.com"]
const REPUBLISHERS = [
  ...REPUBLISHERS_FULL, ...REPUBLISHERS_BAD,
  "jobleads.com", "jobrapido.com", "jobmesh.io", "vaia.com", "jobzmall.com", "bebee.com", "jobright.ai", "trabajo.org",
  "learn4good.com", "recruit.net", "talent.com", "lensa.com", "jooble.org", "adzuna.com", "whatjobs.com", "jobsora.com",
  "jobted.com", "careerjet.com", "getwork.com", "jobsearcher.com", "jobgether.com", "salary.com", "ladders.com",
  "mediabistro.com", "jobtome.com", "grabjobs.co", "jobisjob.com", "joblist.com", "jobcase.com", "sourcingsquare.com",
]

const host = (u: string) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, "") } catch { return "" } }
const onDomain = (h: string, d: string) => h === d || h.endsWith("." + d)

/** Words too common to identify an employer from a host or a source label. */
const GENERIC = new Set([
  "the", "and", "of", "inc", "llc", "llp", "ltd", "corp", "corporation", "company", "co", "group", "holdings", "partners",
  "partnership", "services", "solutions", "management", "advisors", "capital", "financial", "bank", "global",
  "international", "national", "enterprises", "america", "american", "health", "us", "usa", "careers", "jobs", "job",
  "candidate", "experience", "page", "investment", "investments", "wealth", "consulting", "associates", "systems",
  "technologies", "technology", "resources", "human", "staffing", "recruiting", "talent", "network", "trust", "insurance",
])

/** The employer's distinctive words: "Charles Schwab" -> charles, schwab; "ZS" -> zs. */
function companyWords(company: string): string[] {
  return [...new Set(company.toLowerCase().replace(/[’']s\b/g, "").split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !GENERIC.has(w)))]
}

/**
 * Does the host or the source label name the employer? A distinctive word of
 * 4+ letters anywhere, a shorter one only as a whole host label ("jobs.zs.com"),
 * or the whole name run together ("iuhealth", "molsoncoors").
 */
function namesEmployer(h: string, source: string, company: string): boolean {
  const words = companyWords(company)
  const joined = company.toLowerCase().replace(/^the\s+/, "").replace(/\b(inc|llc|llp|ltd|corp|co)\b/g, "").replace(/[^a-z0-9]+/g, "")
  const labels = h.split(".")
  const srcWords = source.toLowerCase().split(/[^a-z0-9]+/)
  const src = srcWords.join("")
  if (joined.length >= 4 && (h.replace(/[^a-z0-9]/g, "").includes(joined) || src.includes(joined))) return true
  return words.some((w) => (w.length >= 4 ? h.includes(w) || src.includes(w) : labels.includes(w) || srcWords.includes(w)))
}

/** ATS hosts whose first host label is the employer's account ("ntrs.wd1.myworkdayjobs.com"). */
const ATS_HOST_ACCOUNT = ["myworkdayjobs.com", "icims.com", "bamboohr.com", "breezy.hr", "applytojob.com", "recruitee.com", "teamtailor.com",
  "pinpointhq.com", "jazzhr.com", "avature.net", "eightfold.ai", "rippling-ats.com"]
/** ATS hosts whose first path segment is the account ("jobs.ashbyhq.com/claim-health"). Any other ATS address carries no readable account. */
const ATS_PATH_ACCOUNT = ["ashbyhq.com", "greenhouse.io", "lever.co", "smartrecruiters.com", "jobvite.com"]
const NOT_AN_ACCOUNT = new Set(["www", "jobs", "job", "boards", "job-boards", "apply", "careers", "career", "recruiting", "en-us", "en", "us", "view", "embed", "o", "p"])

/**
 * The ATS account an address names, as dotted words, or null when the address
 * carries none we can read (Paylocity, Oracle, Workable, Dayforce ids):
 * "jobs.ashbyhq.com/claim-health/..." -> "claim.health".
 */
function atsAccount(url: string): string | null {
  try {
    const u = new URL(url)
    const h = u.hostname.toLowerCase()
    const part = ATS_HOST_ACCOUNT.some((d) => onDomain(h, d)) ? h.split(".")[0]
      : ATS_PATH_ACCOUNT.some((d) => onDomain(h, d)) ? decodeURIComponent(u.pathname.split("/").filter(Boolean)[0] ?? "")
      : ""
    const a = part.toLowerCase()
    return a && !NOT_AN_ACCOUNT.has(a) ? a.replace(/[^a-z0-9]+/g, ".") : null
  } catch { return null }
}

/** LinkedIn's job address names the employer: ".../jobs/view/<title>-at-<company>-<id>". null when it does not say. */
function linkedInEmployer(url: string): string | null {
  const m = url.match(/linkedin\.com\/jobs\/view\/[^/?#]*-at-([a-z0-9-]+?)-\d{6,}/i)
  return m ? m[1].toLowerCase().replace(/-/g, ".") : null
}

const LEGAL = new Set(["the", "of", "and", "inc", "llc", "llp", "ltd", "corp", "corporation", "co", "company", "plc", "sa", "ag", "na"])
const initials = (words: string[]) => words.filter((w) => !LEGAL.has(w)).map((w) => w[0]).join("")

/**
 * Does a name read off an address (dotted words) name the employer? namesEmployer,
 * plus the forms addresses use: initials ("ibm", "aig", "jll" for Jones Lang
 * LaSalle), the employer's own abbreviation spelled out ("charles river
 * associates" for CRA International), or a name inside the employer's ("brg"
 * in Thinkbrg).
 */
function sameEmployer(name: string, company: string): boolean {
  if (namesEmployer(name, "", company)) return true
  const nameWords = name.split(".").filter(Boolean)
  const nameJoined = nameWords.join("")
  const coWords = company.toLowerCase().replace(/[’']s\b/g, "").split(/[^a-z0-9]+/).filter(Boolean)
  const coJoined = coWords.filter((w) => !LEGAL.has(w)).join("")
  const coInitials = initials(coWords)
  if (nameJoined.length >= 3 && (coJoined.includes(nameJoined) || coInitials.includes(nameJoined))) return true
  const nameInitials = initials(nameWords)
  return nameInitials.length >= 3 && coWords.includes(nameInitials)
}

export function classifyLink(url: string, company: string, source = ""): { kind: ApplyLinkKind; rank: number } {
  const h = host(url)
  if (!h) return { kind: "other", rank: 300 }
  if (onDomain(h, "google.com")) return { kind: "google", rank: 500 }
  if (SIGNUP_REQUIRED.some((d) => onDomain(h, d))) return { kind: "republisher", rank: 205 }
  if (REPUBLISHERS.some((d) => onDomain(h, d))) {
    const tier = REPUBLISHERS_FULL.some((d) => onDomain(h, d)) ? 200 : REPUBLISHERS_BAD.some((d) => onDomain(h, d)) ? 220 : 210
    return { kind: "republisher", rank: tier }
  }
  const board = BOARDS.findIndex((d) => onDomain(h, d))
  if (board >= 0) {
    const at = onDomain(h, "linkedin.com") ? linkedInEmployer(url) : null
    if (at && company && !sameEmployer(at, company)) return { kind: "other", rank: 400 }
    return { kind: "board", rank: 100 + board }
  }
  if (ATS.some((d) => onDomain(h, d))) {
    // The ATS account, not the ATS host, says whose job it is.
    if (!company || namesEmployer(h, "", company)) return { kind: "employer", rank: 0 }
    // An account that does not name the employer may be opaque ("jpmc", a
    // Paylocity id) or another company's: still the employer kind, but a board
    // link to the same job is preferred.
    const account = atsAccount(url)
    return !account || sameEmployer(account, company) ? { kind: "employer", rank: 10 } : { kind: "employer", rank: 150 }
  }
  if (namesEmployer(h, source, company)) return { kind: "employer", rank: 0 }
  return { kind: "other", rank: 300 }
}

/** The best link from Google's list, by the order above; ties keep Google's order. */
export function chooseApplyLink(company: string, links: { url?: string | null; source?: string | null }[], shareLink?: string | null): ApplyLink | null {
  const seen = new Set<string>()
  const ranked = links
    .filter((l): l is { url: string; source?: string | null } => !!l.url && !seen.has(l.url) && !!seen.add(l.url))
    .map((l, i) => ({ url: l.url, i, ...classifyLink(l.url, company, l.source ?? "") }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
  if (ranked.length) return { url: ranked[0].url, kind: ranked[0].kind }
  return shareLink ? { url: shareLink, kind: "google" } : null
}

/** Does the link's address name one of these cities? "…/new-york-ny--7a6d…" names "new york". */
export function linkNamesCity(url: string, cities: string[]): boolean {
  let s = url
  try { const u = new URL(url); s = decodeURIComponent(u.hostname + " " + u.pathname) } catch { /* keep the raw string */ }
  const words = ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `
  return cities.some((c) => words.includes(` ${c} `))
}

/**
 * The best link that names one of the client's market cities, or null when
 * none does (the posting's own link stands). For postings that list several
 * offices: a coach check of Sami's queue (2026-10-26) found a link to the
 * Atlanta requisition of a role also hiring in New York. Same order as
 * chooseApplyLink among the links that name the market; Google's share link
 * never counts.
 */
export function chooseMarketLink(company: string, links: { url?: string | null; source?: string | null }[], cities: string[]): ApplyLink | null {
  if (!cities.length) return null
  const named = links.filter((l) => !!l.url && linkNamesCity(l.url, cities))
  const best = chooseApplyLink(company, named)
  return best && best.kind !== "google" ? best : null
}

/** Google's links from a stored raw row, either provider's shape. */
export function linksFromRaw(raw: any): { url: string; source: string }[] {
  const out: { url: string; source: string }[] = []
  if (raw?.apply_link) out.push({ url: String(raw.apply_link), source: String(raw.via ?? "") })
  for (const l of Array.isArray(raw?.apply_links) ? raw.apply_links : []) if (l?.link) out.push({ url: String(l.link), source: String(l.source ?? "") })
  for (const o of Array.isArray(raw?.apply_options) ? raw.apply_options : []) if (o?.link) out.push({ url: String(o.link), source: String(o.title ?? "") })
  return out
}
