// app/api/_lib/workbookError.ts
//
// routeError, plus the one status the workbook routes add: 409 for an autosave
// clash or an already-resolved suggestion, carrying the current value so the
// page can show it instead of silently overwriting.

import { withCorsJson } from "./cors"
import { routeError } from "./routeError"
import { ConflictError } from "@/lib/workbook/server"

export function workbookError(req: Request, err: unknown) {
  if (err instanceof ConflictError) {
    return withCorsJson(req, { ok: false, error: err.message, conflict: true, current: err.current ?? null }, 409)
  }
  return routeError(req, err)
}
