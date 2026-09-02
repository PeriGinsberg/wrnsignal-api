// app/api/_lib/routeError.ts
//
// ONE PLACE THAT TURNS A THROWN ERROR INTO A RESPONSE.
//
// Before this, every handler hand-rolled the same chain in its own catch block:
//
//   const status = /unauthorized/i.test(msg) ? 401 : /profile not found/i.test(msg) ? 404 : 500
//
// Twenty copies across the network routes, and they had already drifted: six
// were missing the /forbidden/i clause, and link-application had its own
// variant using msg.toLowerCase().includes() with a case-SENSITIVE check for
// "Profile not found". A route missing a clause does not fail loudly; it
// answers 500 to an authorisation failure, which reads as a server bug and
// hides a permission bug.
//
// The regexes remain for the errors that are still thrown as bare Error, but
// ForbiddenError is matched BY TYPE and checked first. That is the point: the
// one status this refactor's safety argument depends on no longer rides on a
// string comparison against a message somebody might reword.
//
// Lives beside cors.ts rather than in lib/collab because it is an HTTP concern.
// lib/collab/scope.ts stays free of the response layer so it can be called from
// anywhere, including the tests, without dragging Next in.

import { withCorsJson } from "./cors"
import { ForbiddenError } from "@/lib/collab/scope"

/** The status alone, for callers that need to branch before responding. */
export function errorStatus(err: unknown): number {
  // Typed first, and deliberately not by message. A ForbiddenError whose text
  // someone changes to "Not allowed" must still be a 403.
  if (err instanceof ForbiddenError) return err.status

  const msg = (err as any)?.message || String(err)
  if (/unauthorized/i.test(msg)) return 401
  // Retained for anything still throwing a bare Error with this wording.
  if (/forbidden/i.test(msg)) return 403
  if (/profile not found/i.test(msg)) return 404
  return 500
}

/**
 * The catch-block body for every route. Preserves the shape the routes already
 * returned, byte for byte: { ok: false, error: msg } at the mapped status.
 */
export function routeError(req: Request, err: unknown) {
  const msg = (err as any)?.message || String(err)
  return withCorsJson(req, { ok: false, error: msg }, errorStatus(err))
}
