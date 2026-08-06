// lib/network-tracker/safeReturn.ts
//
// Validating a "where to go after saving" URL that arrived in a query string.
//
// A DESTINATION FROM THE QUERY STRING IS AN OPEN REDIRECT unless it is checked.
// Anyone can hand out a link to our own contacts page carrying a return of
// https://evil.example, and the user would see our domain in the address bar,
// add a real contact, and then be sent somewhere else by a button we rendered.
// That is a phishing primitive, so this is an ALLOWLIST of shape, not a
// blocklist of bad strings.
//
// SEPARATE FROM backTarget.isSafeInternal ON PURPOSE. That function answers
// "where does Back go from a contact record" and only permits
// /dashboard/network, which is right for it. Widening it to admit
// /dashboard/tracker would change what Back does on every contact record,
// including ones reached from the networking side, to solve an unrelated
// problem. Two concepts sharing one validator is how both end up wrong.
//
// Pure. No I/O, no DOM, no storage.

/** Everything reachable must sit under the signed-in app. */
const PREFIX = "/dashboard/"

/**
 * True when `url` is a path inside the dashboard and cannot navigate off-site.
 *
 * Rejects, in order of how easy each is to miss:
 *   "//evil.com"            protocol-relative. Browsers treat this as absolute,
 *                           and it passes a naive startsWith("/") check.
 *   "https://evil.com"      absolute with a scheme
 *   "/dashboard/../../x"    traversal back out of the prefix
 *   "\\evil.com"            backslashes, which some browsers normalise to "/"
 *   "/dashboard/x\n"        control characters, which can split a header
 */
export function isSafeReturn(url: unknown): url is string {
  if (typeof url !== "string") return false
  const u = url.trim()
  if (!u) return false

  // Control characters, including the newline that would let this be smuggled
  // into a header somewhere downstream. Checked by CODEPOINT rather than a
  // regex range: writing the range as an escape put raw control bytes into
  // this source file, which made git treat it as binary. Explicit beats
  // clever when the characters themselves are the thing being matched.
  if (u.split("").some((ch) => {
    const c = ch.charCodeAt(0)
    return c < 32 || c === 127
  })) return false

  // Backslashes never appear in a legitimate path here and some browsers treat
  // them as separators, so "/dashboard\\..\\evil" is not worth reasoning about.
  if (u.includes("\\")) return false

  // A scheme, or protocol-relative. Checked before the prefix test because
  // "//evil.com" does start with a slash.
  if (u.startsWith("//")) return false
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(u)) return false

  if (!u.startsWith(PREFIX)) return false

  // Traversal. Compare against the path only: a query string may legitimately
  // contain "..", and a fragment is never sent to the server.
  const path = u.split(/[?#]/)[0]
  if (path.split("/").includes("..")) return false

  return true
}

/** The URL when it is safe, otherwise null so the caller renders nothing. */
export function safeReturn(url: unknown): string | null {
  return isSafeReturn(url) ? url.trim() : null
}

/**
 * The words on the button. Trimmed and capped, because it is attacker-supplied
 * text rendered as a control: React escapes it, so the risk is not injection
 * but a label long enough to push the real actions off screen, or one crafted
 * to say something the button does not do.
 */
export const MAX_RETURN_LABEL = 80

export function safeReturnLabel(label: unknown): string | null {
  if (typeof label !== "string") return null
  const t = label.replace(/\s+/g, " ").trim()
  if (!t) return null
  return t.slice(0, MAX_RETURN_LABEL)
}
