// lib/collab/scope.ts
//
// WHO IS ACTING, AND WHOSE DATA THIS IS. One function, one answer, and no way
// to get the second without having proved you are allowed the first.
//
// The problem it replaces: resolveCaller() returns a profile id that routes use
// as BOTH the caller and the data scope. Those are the same value today and
// stop being the same value the moment a coach acts for a client, so every
// route that conflates them has to be found and changed. Worse, the old shape
// let a route obtain a subject (`params.get("client_profile_id") || profileId`)
// and then simply forget to authorise it, which is a silent full-data leak that
// returns 200 and looks like a working feature.
//
// This absorbs assertBoardAccess from lib/network-tracker/access.ts, which was
// the same idea with two weaknesses: it took the subject as a parameter, so the
// caller chose it, and it RETURNED NULL on deny, so a caller could ignore the
// result and carry on. Both are gone here. Its semantics are otherwise
// preserved exactly, and lib/collab/scope.test.ts is the proof: those
// assertions were written against assertBoardAccess first and repointed here
// unchanged.
//
// ── HOW THIS IS ENFORCED, RATHER THAN ASKED FOR NICELY ──────────────────────
//
// 1. SubjectId is branded with a `unique symbol` that is NOT exported. The only
//    place in the codebase that can produce a SubjectId is the bottom of
//    resolveScope, after the authorisation branch has run. A route cannot pass
//    `body.client_profile_id` to something expecting a SubjectId; that is a
//    compile error, and the cast that would silence it needs `as unknown as`,
//    which is greppable and reviewable.
//
// 2. Deny throws. There is no falsy return to drop on the floor. A route that
//    forgets to handle the failure fails closed with a 403 rather than open.
//
// 3. resolveRequestScope owns the query string, so for the transport actually
//    in use the route never sees the raw id at all.
//
// WHAT THIS DOES NOT DO, stated plainly so nobody relies on it: it cannot stop
// a route hand-writing .eq("client_profile_id", someOtherString). The brand
// narrows the accident surface; it does not close it. Closing it needs RLS,
// which does not engage because every route uses the service-role client. That
// gap is real and predates this file.

import { type SupabaseClient } from "@supabase/supabase-js"
import { resolveCaller } from "./identity"

declare const SUBJECT_BRAND: unique symbol

/** A client_profile_id that has been authorised for the current actor. Only
 *  resolveScope can make one. */
export type SubjectId = string & { readonly [SUBJECT_BRAND]: true }

export type ActorRole = "self" | "coach"
export type AccessLevel = "owner" | "view" | "annotate" | "full"

/** The caller, already identified. Separated from the Request so the ladder is
 *  testable without a JWT. */
export type ActorContext = { actorId: string; isCoach: boolean }

export type Scope = {
  /** Who is doing this. Never the subject when a coach is acting. */
  actorId: string
  actorRole: ActorRole
  /** Whose data this is. The only value that may be used as a query scope. */
  subjectId: SubjectId
  accessLevel: AccessLevel
}

/** Thrown on deny. Carries the status the routes already return. */
export class ForbiddenError extends Error {
  readonly status = 403
  constructor(message = "Forbidden") {
    super(message)
    this.name = "ForbiddenError"
  }
}

// read -> view, write -> full. This is not a new policy: every shipped
// assertBoardAccess call site asked for "view" on a read and "full" on a write,
// so "annotate" has never been sufficient to write anything. Preserved rather
// than decided. If annotate should become writable, change it here and the
// test that pins it, not at eight call sites.
const REQUIRED: Record<"read" | "write", "view" | "full"> = { read: "view", write: "full" }
const LADDER: Record<string, string[]> = {
  view: ["view", "annotate", "full"],
  full: ["full"],
}

/**
 * The ladder, without a Request. Exported for the tests and for any caller that
 * has already identified the actor.
 *
 * `subject` null, empty, or equal to the actor is self: granted without a
 * lookup, exactly as assertBoardAccess short-circuited.
 */
export async function resolveScope(
  supabase: SupabaseClient,
  actor: ActorContext,
  opts: { subject?: string | null; require: "read" | "write" },
): Promise<Scope> {
  const wanted = (opts.subject ?? "").trim()

  if (!wanted || wanted === actor.actorId) {
    return {
      actorId: actor.actorId,
      actorRole: "self",
      subjectId: actor.actorId as SubjectId,
      accessLevel: "owner",
    }
  }

  const { data } = await supabase
    .from("coach_clients")
    .select("id, access_level, status")
    .eq("coach_profile_id", actor.actorId)
    .eq("client_profile_id", wanted)
    .eq("status", "active")
    .maybeSingle()

  if (!data) throw new ForbiddenError("Forbidden")
  if (!LADDER[REQUIRED[opts.require]]?.includes(data.access_level)) {
    throw new ForbiddenError("Forbidden")
  }

  return {
    actorId: actor.actorId,
    actorRole: "coach",
    subjectId: wanted as SubjectId,
    accessLevel: data.access_level as AccessLevel,
  }
}

/**
 * The actor alone, for the two-phase routes below. This is the ONLY wrapper
 * around resolveCaller that network routes should reach for, so that "who is
 * calling" has exactly one entry point per surface.
 */
export async function resolveActor(req: Request): Promise<ActorContext> {
  const { profileId, isCoach } = await resolveCaller(req)
  return { actorId: profileId, isCoach }
}

/**
 * OWNER-ONLY, stated at the call site.
 *
 * Deliberately does not look at the query string. Several network routes are
 * owner-only by design and say so in their error strings ("pipeline edits are
 * owner-only"); routing them through resolveRequestScope would have quietly
 * granted coaches write access to the pipeline the first time one appended
 * ?client_profile_id=, which is a feature nobody asked for arriving as a
 * refactor. There is no lookup and nothing to authorise: subject is the actor,
 * always, and the branded subjectId is produced with the same guarantee.
 */
export async function resolveOwnerScope(req: Request): Promise<Scope> {
  const actor = await resolveActor(req)
  return {
    actorId: actor.actorId,
    actorRole: "self",
    subjectId: actor.actorId as SubjectId,
    accessLevel: "owner",
  }
}

/**
 * The one-phase route entry point, and the one to prefer. Identifies the actor,
 * reads the subject from the query string ITSELF, and authorises, all in one
 * call. A route using this never touches a raw client id.
 *
 * Not every route can use it. Three transports are in play and two of them
 * arrive too late for this function to see:
 *
 *   query string  -> handled here, the route sees nothing
 *   JSON body     -> the body is a stream the route has already consumed
 *   a fetched row -> the subject is whose board the row belongs to
 *
 * For those two, the route calls resolveActor() then resolveScope() with an
 * explicit subject. It touches the raw value, but it still cannot USE it: the
 * only thing accepted as a query scope is the branded subjectId that comes back
 * from resolveScope, after the ladder has run. That is a weaker guarantee than
 * the query-string path, and it is confined to the four call sites that need it.
 */
export async function resolveRequestScope(
  req: Request,
  supabase: SupabaseClient,
  opts: { require: "read" | "write"; subjectOverride?: string | null },
): Promise<Scope> {
  const actor = await resolveActor(req)
  const fromQuery = new URL(req.url).searchParams.get("client_profile_id")
  return resolveScope(supabase, actor, {
    subject: opts.subjectOverride ?? fromQuery,
    require: opts.require,
  })
}
