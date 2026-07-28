// Where "← Back" goes from a contact record.
//
// WHY A BREADCRUMB RATHER THAN history.back()
// The literal browser-history call is the obvious answer and it fails in the two
// cases that matter. `router.back()` on a directly-opened URL (fresh tab, pasted
// link, bookmark) walks OUT of the app entirely, and there is no reliable way to
// ask "is there in-app history?" — Next sets window.history.state on hydration
// too, so it can't be used to tell a client navigation from a cold load.
// `document.referrer` is no help either: it stays empty across App Router client
// navigations, which is exactly how every one of these origins is reached.
//
// So the origin is recorded explicitly as the user moves around. It gives the
// same behaviour with a defined fallback, and because the recorded value keeps
// the QUERY STRING, going back to a filtered Contacts view returns to it still
// filtered rather than dumping the user on an unfiltered list.

const KEY = "network:origin"

// The most common origin by a distance — deliberately NOT Today, which is where
// the old hardcoded link always went.
export const DEFAULT_BACK = "/dashboard/network/contacts"

// A contact record is never its own back target: /dashboard/network/contacts/<id>.
// The list itself (/dashboard/network/contacts) must NOT match.
export function isRecordRoute(pathname: string): boolean {
  return /^\/dashboard\/network\/contacts\/[^/]+\/?$/.test(pathname)
}

// Only ever return somewhere inside the tracker. sessionStorage is same-origin,
// so this is belt-and-braces rather than a real attack surface — but a stored
// value that has drifted or been hand-edited should degrade to the default, not
// navigate somewhere arbitrary.
function isSafeInternal(url: string): boolean {
  return url.startsWith("/dashboard/network")
}

export function rememberOrigin(url: string): void {
  try {
    const path = url.split("?")[0]
    if (isRecordRoute(path) || !isSafeInternal(path)) return
    sessionStorage.setItem(KEY, url)
  } catch {
    // Private mode / storage disabled — the default target still works.
  }
}

export function readBackTarget(): string {
  try {
    const stored = sessionStorage.getItem(KEY)
    if (stored && isSafeInternal(stored)) return stored
  } catch {
    // fall through
  }
  return DEFAULT_BACK
}
