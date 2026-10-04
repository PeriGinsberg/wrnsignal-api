// lib/collab/errors.ts
//
// The access errors, in a module with no imports of its own, so both
// identity.ts (who is calling) and scope.ts (whose data this is) can throw
// them. scope.ts imports identity.ts, so the class could not live in scope.ts
// and be thrown from identity.ts without a circular import. scope.ts
// re-exports it, so `import { ForbiddenError } from "@/lib/collab/scope"` and
// `instanceof` keep working everywhere.

/** Thrown on deny. Carries the status the routes already return. */
export class ForbiddenError extends Error {
  readonly status = 403
  constructor(message = "Forbidden") {
    super(message)
    this.name = "ForbiddenError"
  }
}
