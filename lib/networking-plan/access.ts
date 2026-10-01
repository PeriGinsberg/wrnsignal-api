// lib/networking-plan/access.ts
// Who may act on a Networking Plan once it is built.
//
// A plan is a coaching artifact: a coach builds it, reviews it and decides when
// the client sees it. plan/run already refuses an owner working on their own
// board (it finds no coach_clients row). Share and Re-send did not, so a client
// could release their own plan, skip the review, email themselves and close
// the chain's Share task. Same rule, one place.

import type { Scope } from "@/lib/collab/scope"

export const COACH_ONLY_MESSAGE = "A Networking Plan is created by a coach for a client."

/** The refusal message, or null when the caller is a coach acting on a client. */
export function planActionRefusal(scope: Pick<Scope, "actorRole">): string | null {
  return scope.actorRole === "coach" ? null : COACH_ONLY_MESSAGE
}
