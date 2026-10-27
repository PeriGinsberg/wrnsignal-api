/**
 * The nightly apply-link check: is the job still open?
 *
 * WHAT PROMPTED IT. A coach review of Sami's top 14 (2026-10-26) found
 * postings whose apply page said the job was gone. Google keeps a listing
 * after the employer closes it, so last_seen_at alone cannot tell.
 *
 * WHAT IT CHECKS: the apply link of every posting in the top 30 of each active
 * client's queue, as that client sees it (their market link when they have
 * one). One GET each, no retry beyond the one request.
 *
 * FOUR VERDICTS per posting, and only closed takes it out of the queue:
 *   closed   the page SAYS so: closed, expired, filled, no longer accepting,
 *            no longer available. Sets postings.closed_at, which takes the
 *            posting out of every client's queue and out of matching.
 *   unknown  anything that is not a clear answer: a bot wall (captcha,
 *            "verify you are human", 403, 429), a timeout, a 404 or 410, a
 *            network error. Recorded, never closed: a wrong close is a job the
 *            coach never sees, which is the quiet failure.
 *   open     the page loaded and says none of the above.
 *   likely_closed  the client's link was unknown, so the posting's other apply
 *            links were checked too, and every one that gave an answer was a
 *            404 or 410, none live (Daniel's Deloitte rows, 2026-10-27). Never
 *            sets closed_at: the posting stays in the queue, ranked last. Bot
 *            walls alone stay unknown.
 * Every check is recorded on the posting (link_check_status, _evidence, _url,
 * link_checked_at), so a close is checkable from the quote that caused it.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { linksFromRaw } from "../ingest/applyLinks"

/** One link. gone = a 404 or 410 that was not a bot wall: the page answered that it is not there. */
export type LinkVerdict = { status: "open" | "closed" | "unknown"; evidence: string; httpStatus: number | null; gone?: boolean }
export type PostingLinkStatus = "open" | "closed" | "likely_closed" | "unknown"

/**
 * Phrases that mean the job is gone. Each names the job or the applications,
 * so a sentence about something else ("this feature is no longer available")
 * does not count.
 */
const JOB = "(?:job|position|posting|role|vacancy|listing|opening|opportunity|requisition|job posting|job listing|job opening)"
const CLOSED: RegExp[] = [
  /no longer accepting (?:new )?(?:applications|applicants|candidates)/i,
  /(?:not|no longer) (?:currently )?accepting applications for this/i,
  new RegExp(`(?:this|the) ${JOB} (?:has|is|was) (?:now )?(?:been )?(?:closed|expired|filled|removed|taken down|archived)`, "i"),
  new RegExp(`(?:this|the) ${JOB} (?:is|has been) no longer (?:available|open|active|posted|listed)`, "i"),
  new RegExp(`${JOB} (?:is )?no longer (?:available|open|active)`, "i"),
  new RegExp(`${JOB} (?:has )?expired`, "i"),
  /applications (?:for this [a-z ]+ )?(?:are|have) (?:now )?closed/i,
  /(?:the )?position has been filled/i,
]

/**
 * Robot checks and blocks: the page is not the job page, so it says nothing
 * about the job. Phrases a wall shows, not the word "captcha": job pages load
 * a captcha widget for their apply form (Jobilize, Liberty Mutual, 2026-10-26).
 */
const BOT_WALL = /(?:complete|solve) the (?:security )?captcha|captcha (?:challenge|verification)|are you (?:a )?(?:human|robot)|verify (?:that )?you are (?:a )?human|not a robot|just a moment\.\.\.|checking your browser|access denied|unusual traffic|enable javascript and cookies to continue|request unsuccessful\. incapsula|pardon our interruption/i
const BOT_WALL_HTML = /px-captcha|cf-browser-verification|_cf_chl_opt|challenge-platform/i

/**
 * LinkedIn answers a job page fetched by a server with 429, and its public
 * job endpoint with the job card, which says "No longer accepting
 * applications" once the job closes. Other links are fetched as they are.
 */
export function fetchUrlFor(url: string): string {
  const m = url.match(/^https?:\/\/(?:[a-z]+\.)?linkedin\.com\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})/i)
  return m ? `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${m[1]}` : url
}

/** The page's visible text: scripts, styles and tags removed. */
export function visibleText(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim()
}

/** One fetched page -> a verdict. Pure. */
export function classifyPage(httpStatus: number | null, html: string): LinkVerdict {
  if (httpStatus === null) return { status: "unknown", evidence: "no response", httpStatus }
  const text = visibleText(html)
  const wall = text.match(BOT_WALL) ?? html.match(BOT_WALL_HTML)
  if (wall || [401, 403, 429, 999].includes(httpStatus)) return { status: "unknown", evidence: `bot wall or block (HTTP ${httpStatus}${wall ? `, "${wall[0]}"` : ""})`, httpStatus }
  if (httpStatus >= 400) return { status: "unknown", evidence: `HTTP ${httpStatus}`, httpStatus, gone: httpStatus === 404 || httpStatus === 410 }
  for (const re of CLOSED) {
    const m = text.match(re)
    if (m) {
      const at = m.index ?? 0
      return { status: "closed", evidence: text.slice(Math.max(0, at - 60), at + m[0].length + 60).trim(), httpStatus }
    }
  }
  return { status: "open", evidence: "", httpStatus }
}

/**
 * A posting's links -> its verdict. Pure. Closed if any page says so; open if
 * any loaded; likely_closed if at least one answered 404/410 and none was live
 * (walls and errors are not answers); else unknown.
 */
export function postingVerdict(links: { url: string; v: LinkVerdict }[]): { status: PostingLinkStatus; evidence: string; url: string | null } {
  const closed = links.find((x) => x.v.status === "closed")
  if (closed) return { status: "closed", evidence: closed.v.evidence, url: closed.url }
  const open = links.find((x) => x.v.status === "open")
  if (open) return { status: "open", evidence: "", url: open.url }
  const gone = links.filter((x) => x.v.gone)
  const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "") } catch { return u.slice(0, 60) } }
  if (gone.length) return {
    status: "likely_closed",
    evidence: links.map((x) => `${x.v.evidence} ${host(x.url)}`).join("; ").slice(0, 1000),
    url: gone[0].url,
  }
  return { status: "unknown", evidence: links[0]?.v.evidence ?? "no link", url: links[0]?.url ?? null }
}

/** Other apply links checked when the client's own link is unknown. */
const MAX_EXTRA_LINKS = 4

const TIMEOUT_MS = 15_000
const MAX_BYTES = 2_000_000
const HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml",
  "accept-language": "en-US",
}

export async function checkLink(url: string): Promise<LinkVerdict> {
  try {
    const res = await fetch(fetchUrlFor(url), { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) })
    const html = (await res.text()).slice(0, MAX_BYTES)
    return classifyPage(res.status, html)
  } catch (e: any) {
    return { status: "unknown", evidence: String(e?.name === "TimeoutError" ? "timed out" : e?.message ?? e).slice(0, 200), httpStatus: null }
  }
}

export type LinkCheckSummary = {
  clients: number
  postings: number
  links: number
  open: number
  closed: number
  likelyClosed: number
  unknown: number
  closedRows: CheckedRow[]
  likelyClosedRows: CheckedRow[]
  unknownRows: CheckedRow[]
}
type CheckedRow = { postingId: string; title: string; company: string; url: string; evidence: string }

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { for (;;) { const i = next++; if (i >= items.length) return; await fn(items[i]) } }))
}

/**
 * Check the top `top` of every active client's queue (or one client's).
 * Writes the verdict to postings unless dryRun. A posting in several clients'
 * top 30 is checked once per distinct link; one closed link closes it. When
 * the client's link gives no answer, up to MAX_EXTRA_LINKS of the posting's
 * other apply links are checked as well.
 */
export async function runLinkCheck(
  sb: SupabaseClient,
  opts: { top?: number; clientProfileId?: string; dryRun?: boolean } = {},
): Promise<LinkCheckSummary> {
  const top = opts.top ?? 30
  let q = sb.from("client_match_queue").select("client_profile_id, posting_id, title, company, apply_url, rank").lte("rank", top)
  if (opts.clientProfileId) q = q.eq("client_profile_id", opts.clientProfileId)
  const { data, error } = await q
  if (error) throw new Error(`client_match_queue: ${error.message}`)
  const rows = (data ?? []).filter((r: any) => r.apply_url)

  // One check per (posting, link).
  const work = new Map<string, any>()
  for (const r of rows) work.set(`${r.posting_id} ${r.apply_url}`, r)
  const checked = new Map<string, { row: any; links: { url: string; v: LinkVerdict }[] }>()
  await pool([...work.values()], 6, async (r) => {
    const v = await checkLink(r.apply_url)
    const cur = checked.get(r.posting_id) ?? { row: r, links: [] }
    cur.links.push({ url: r.apply_url, v })
    checked.set(r.posting_id, cur)
  })

  // No answer from the client's link: try the posting's other apply links, so a
  // run of 404/410s behind a walled link can still say likely closed.
  const unsure = [...checked.entries()].filter(([, c]) => postingVerdict(c.links).status === "unknown").map(([id]) => id)
  for (let i = 0; i < unsure.length; i += 100) {
    const { data: raws, error: rErr } = await sb.from("postings").select("id, raw").in("id", unsure.slice(i, i + 100))
    if (rErr) throw new Error(`postings raw: ${rErr.message}`)
    const extra: { id: string; url: string }[] = []
    for (const p of raws ?? []) {
      const seen = new Set(checked.get(p.id)!.links.map((l) => l.url))
      for (const l of linksFromRaw(p.raw).filter((l) => !seen.has(l.url)).slice(0, MAX_EXTRA_LINKS)) { seen.add(l.url); extra.push({ id: p.id, url: l.url }) }
    }
    await pool(extra, 6, async (x) => { checked.get(x.id)!.links.push({ url: x.url, v: await checkLink(x.url) }) })
  }

  const byPosting = new Map([...checked.entries()].map(([id, c]) => [id, { row: c.row, links: c.links.length, v: postingVerdict(c.links) }]))

  const now = new Date().toISOString()
  if (!opts.dryRun) {
    for (const [id, { row, v }] of byPosting) {
      const patch: Record<string, unknown> = {
        link_checked_at: now, link_check_status: v.status, link_check_evidence: v.evidence || null, link_check_url: v.url ?? row.apply_url,
      }
      // Only a page that says closed closes. likely_closed stays visible, ranked last.
      if (v.status === "closed") patch.closed_at = now
      const { error: uErr } = await sb.from("postings").update(patch).eq("id", id)
      if (uErr) throw new Error(`postings update ${id}: ${uErr.message}`)
    }
  }

  const all = [...byPosting.values()]
  const listed = (status: PostingLinkStatus) => all.filter((x) => x.v.status === status)
    .map(({ row, v }) => ({ postingId: row.posting_id, title: row.title, company: row.company, url: v.url ?? row.apply_url, evidence: v.evidence }))
  return {
    clients: new Set(rows.map((r: any) => r.client_profile_id)).size,
    postings: byPosting.size,
    links: all.reduce((n, x) => n + x.links, 0),
    open: all.filter((x) => x.v.status === "open").length,
    closed: all.filter((x) => x.v.status === "closed").length,
    likelyClosed: all.filter((x) => x.v.status === "likely_closed").length,
    unknown: all.filter((x) => x.v.status === "unknown").length,
    closedRows: listed("closed"),
    likelyClosedRows: listed("likely_closed"),
    unknownRows: listed("unknown"),
  }
}
