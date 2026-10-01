// Where a task is done.
//
// THE RULE: a system task carries a link, a manual task may. A task SIGNAL
// raised by itself is a claim that there is work to do; if the product cannot
// say where, it has told somebody to go and find it. A coach writing their own
// task already knows where they meant, so a link there is a convenience.
//
// This module is the inventory. Every system task type in the product resolves
// its destination through `templateLink` (for the automation chain, which is
// data) or through one of the named builders below (for the handful raised
// directly in code). Adding a new system task without touching this file is
// possible only by bypassing createTask, which is why createTask refuses an
// auto task with no link.

/** Where the app lives. Links are paths, never absolute URLs; see below. */
const PREFIX = "/dashboard/"

/**
 * Is this a link the product may render as a Go button?
 *
 * SAME-ORIGIN PATHS ONLY, and the check is a whitelist rather than a blocklist
 * of schemes. A Go button is an element people are trained to press without
 * reading, sitting on a row that SIGNAL itself vouched for by calling it a
 * system task; an absolute URL there is a phishing primitive wearing the
 * product's own chrome. Task titles and descriptions already come partly from
 * client-supplied names, so "it is only ever set by us" is not a property this
 * can rely on.
 *
 * Protocol-relative ("//evil.test") is the case a naive `startsWith("/")`
 * misses: the browser reads it as a full URL with the current scheme.
 */
export function isSafeTaskLink(v: unknown): v is string {
  if (typeof v !== "string") return false
  const s = v.trim()
  if (!s.startsWith(PREFIX)) return false
  if (s.startsWith("//")) return false
  // A backslash is normalised to a forward slash by browsers in some
  // positions, so "/\evil.test" can escape the origin the same way.
  if (s.includes("\\")) return false
  return true
}

/** Trim, validate, and return null for anything that is not a usable link. */
export function cleanTaskLink(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  if (!s) return null
  return isSafeTaskLink(s) ? s : null
}

// ---------------------------------------------------------------------------
// The builders. One per system task type.
// ---------------------------------------------------------------------------

/** The client record, optionally opened on one of its tabs. */
export function clientLink(clientId: string, tab?: string): string {
  return `/dashboard/coach/clients/${clientId}${tab ? `?tab=${tab}` : ""}`
}

/**
 * A client's networking board, which is where the campaign brief is written,
 * reviewed, and where the plan is shared from.
 *
 * `client_profile_id` is the param the board reads to scope itself to someone
 * else's data; without it a coach lands on their own board and the brief panel
 * does not render at all.
 */
export function networkBoardLink(clientId: string): string {
  return `/dashboard/network?client_profile_id=${encodeURIComponent(clientId)}`
}

/** Where a networking list is uploaded and the plan built. */
export function networkImportLink(clientId: string): string {
  return `/dashboard/network/import?client_profile_id=${encodeURIComponent(clientId)}`
}

/**
 * One workbook, open, on the coach's side.
 *
 * The coach reads a workbook inside the client record's Workbooks tab rather
 * than at a route of its own, so this is the tab plus the id it should open
 * on. WorkbooksTab reads `workbook` from the query string; without it the
 * coach lands on a list and has to find the one the task meant.
 */
export function workbookLink(clientId: string, workbookId: string): string {
  return `${clientLink(clientId, "workbooks")}&workbook=${encodeURIComponent(workbookId)}`
}

/**
 * The note an action-item task came from, scrolled to.
 *
 * A prospect has no client record yet, so its notes live on the prospect page
 * (keyed by the relationship); a client's live on the Notes tab. The #note-
 * anchor is what both lists render on each card.
 */
export function noteLink(note: { id: string; coach_client_id: string; client_profile_id: string | null }): string {
  const anchor = `#note-${note.id}`
  return note.client_profile_id
    ? `${clientLink(note.client_profile_id, "notes")}${anchor}`
    : `/dashboard/coach/prospects/${note.coach_client_id}${anchor}`
}

/** A prospect's page, or its consult screen. Keyed by the relationship: a prospect has no profile. */
export function prospectLink(coachClientId: string, page: "record" | "consult" = "record"): string {
  const base = `/dashboard/coach/prospects/${encodeURIComponent(coachClientId)}`
  return page === "consult" ? `${base}/consult` : base
}

/** One practice round, on the coach's side: playback and the feedback boxes. */
export function practiceRoundLink(roundId: string): string {
  return `/dashboard/coach/practice/${roundId}`
}

// ---------------------------------------------------------------------------
// The automation chain
// ---------------------------------------------------------------------------

/**
 * Resolve a template's `link_template` against one task's context.
 *
 * Tokens rather than a switch on the template key, because the chain is meant
 * to be rows: a sixth networking step, or a second chain entirely, should be
 * an INSERT and not a deploy. `{clientId}` is the only token every template
 * can count on.
 */
export function resolveLinkTemplate(
  pattern: string | null | undefined,
  ctx: { clientId?: string | null; briefId?: string | null },
): string | null {
  if (!pattern) return null
  let out = pattern
  for (const [token, value] of [["clientId", ctx.clientId], ["briefId", ctx.briefId]] as const) {
    const needle = `{${token}}`
    if (!out.includes(needle)) continue
    // A template asking for a value this task does not have resolves to
    // nothing rather than to a URL with "{clientId}" in it. The caller then
    // falls back, and createTask refuses the task if there is no fallback.
    if (!value) return null
    out = out.split(needle).join(encodeURIComponent(value))
  }
  return cleanTaskLink(out)
}

/**
 * The link a networking-chain template should carry, by key.
 *
 * SEEDED INTO THE TEMPLATE ROWS by the migration, not consulted at runtime:
 * once `link_template` is set, `resolveLinkTemplate` is the only path. This
 * constant is the source the migration and the backfill both read, so the
 * inventory has exactly one spelling.
 */
export const TEMPLATE_LINKS: Record<string, string> = {
  // Erin writes the brief on the client's board.
  "networking.create_campaign": "/dashboard/network?client_profile_id={clientId}",
  // Same screen: "define" is the pre-chain variant of the same work.
  "networking.define_campaign": "/dashboard/network?client_profile_id={clientId}",
  // Peri reads the submitted brief in the same panel and approves there.
  "networking.review_campaign": "/dashboard/network?client_profile_id={clientId}",
  // The one step with its own screen.
  "networking.upload_and_build": "/dashboard/network/import?client_profile_id={clientId}",
  // Sharing happens from the plan bar on the board.
  "networking.share_plan": "/dashboard/network?client_profile_id={clientId}",
}

/**
 * Last-resort destination for a system task whose own builder produced nothing.
 *
 * The client record is never the *exact* screen, so this is not a substitute
 * for a real link and callers should not reach for it first. It exists so that
 * a task which would otherwise be refused at creation still reaches somebody:
 * a reminder that lands one click away beats a rule that silently stops firing.
 */
export function fallbackLink(clientId: string | null | undefined): string | null {
  return clientId ? clientLink(clientId) : null
}
