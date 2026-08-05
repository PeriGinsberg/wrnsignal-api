// lib/network-tracker/link-application.ts
//
// Linking one tracked application to one company on the networking board.
//
// THIS MODULE IS THE ONLY PATH TO A LINK, and it exists as a module rather than
// inline route code for one reason: the boundary it enforces cannot be enforced
// by the database, so it has to be testable in isolation.
//
// THE BOUNDARY. signal_applications is owned by profile_id and
// network_companies by client_profile_id. The foreign key added in
// 20260805_application_company_link.sql proves the company row EXISTS. It
// cannot prove it belongs to the same person, and a CHECK constraint may not
// reference another table. So a request naming someone else's company_id would
// be accepted by Postgres, and the only thing standing between that and a
// cross-profile leak is this file remembering to compare two uuids.
//
// A guard that holds because someone remembered is the same shape as the
// is_coach denylist hole, where a field nobody thought about was writable
// because the list was of things to exclude rather than things to allow. So
// there is a test that attempts exactly this and asserts rejection, and it
// drives THIS function rather than a helper the route might not call.
//
// Every query is scoped by profileId. On the by-name path a cross-profile link
// is not merely rejected, it is unrepresentable: the lookup and the insert both
// pin client_profile_id, so the function can only ever find or create a company
// the caller owns.

import type { SupabaseClient } from "@supabase/supabase-js"

/** Postgres unique_violation. See resolveCompanyByName for why it means success. */
export const UNIQUE_VIOLATION = "23505"

export type LinkOutcome =
  | { ok: true; companyId: string; companyName: string; created: boolean }
  | { ok: false; status: 400 | 403 | 404 | 500; error: string }

export type LinkInput = {
  applicationId: string
  /** Link to a company the user picked. Ownership is CHECKED. */
  companyId?: string | null
  /** Find-or-create by name. Ownership is STRUCTURAL, never checked. */
  companyName?: string | null
}

/** Trimmed, and empty means absent. Mirrors the routes' String(x||"").trim(). */
const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "")

/**
 * Find a company the caller owns by name, or create it.
 *
 * THE UNIQUE VIOLATION IS A SUCCESS, NOT AN ERROR. `uq_network_companies_name`
 * is UNIQUE on (client_profile_id, lower(name)), so a concurrent create loses
 * the race with 23505. Checking first and inserting second does not remove the
 * race, it only narrows it, and the index is the thing that is actually true.
 * So: try, and on 23505 re-read and use the row that won.
 *
 * From where the user stands there is no difference between "we made it" and
 * "it was already there". They asked for the company to be on their board, and
 * it is. Reporting "that company already exists" as a failure would be the
 * system describing its own internals as the user's problem.
 */
async function resolveCompanyByName(
  supabase: SupabaseClient,
  profileId: string,
  name: string,
): Promise<{ id: string; name: string; created: boolean } | { error: string }> {
  // ilike with no wildcards is case-insensitive EQUALITY, which is the same
  // comparison lower(name) makes in the unique index.
  const { data: found, error: findErr } = await supabase
    .from("network_companies")
    .select("id, name")
    .eq("client_profile_id", profileId)
    .ilike("name", name)
    .maybeSingle()
  if (findErr) return { error: `Company lookup failed: ${findErr.message}` }
  if (found) return { id: found.id as string, name: found.name as string, created: false }

  const { data: made, error: insertErr } = await supabase
    .from("network_companies")
    .insert({ client_profile_id: profileId, name })
    .select("id, name")
    .single()

  if (!insertErr && made) return { id: made.id as string, name: made.name as string, created: true }

  if ((insertErr as { code?: string } | null)?.code === UNIQUE_VIOLATION) {
    // Lost the race. The winner is the row we wanted.
    const { data: raced, error: reErr } = await supabase
      .from("network_companies")
      .select("id, name")
      .eq("client_profile_id", profileId)
      .ilike("name", name)
      .maybeSingle()
    if (reErr) return { error: `Company lookup failed: ${reErr.message}` }
    if (raced) return { id: raced.id as string, name: raced.name as string, created: false }
    return { error: "Company create raced and vanished" }
  }

  return { error: `Company create failed: ${insertErr?.message ?? "unknown"}` }
}

/**
 * Link an application to a board company. Returns an outcome rather than
 * throwing, so the route maps it to a status without a second decision.
 *
 * `supabase` is a parameter and not a module-level client precisely so the test
 * can drive this with a fake and prove the rejection happens here.
 */
export async function linkApplicationToCompany(
  supabase: SupabaseClient,
  profileId: string,
  input: LinkInput,
): Promise<LinkOutcome> {
  const applicationId = clean(input.applicationId)
  const companyId = clean(input.companyId)
  const companyName = clean(input.companyName)

  if (!applicationId) return { ok: false, status: 400, error: "application_id is required" }
  if (!companyId && !companyName) {
    return { ok: false, status: 400, error: "company_id or company_name is required" }
  }

  // 1. The application must exist AND belong to the caller. Checked before
  //    anything is created, so a bad application id cannot leave a stray
  //    company row behind on the by-name path.
  const { data: app, error: appErr } = await supabase
    .from("signal_applications")
    .select("id, profile_id")
    .eq("id", applicationId)
    .maybeSingle()
  if (appErr) return { ok: false, status: 500, error: `Application lookup failed: ${appErr.message}` }
  if (!app) return { ok: false, status: 404, error: "Application not found" }
  if (app.profile_id !== profileId) return { ok: false, status: 403, error: "Not authorized" }

  // 2. Resolve the company.
  let resolved: { id: string; name: string; created: boolean }

  if (companyId) {
    // THE CROSS-PROFILE CHECK. The FK would happily accept another user's
    // company id, so this comparison is the whole boundary.
    const { data: co, error: coErr } = await supabase
      .from("network_companies")
      .select("id, name, client_profile_id")
      .eq("id", companyId)
      .maybeSingle()
    if (coErr) return { ok: false, status: 500, error: `Company lookup failed: ${coErr.message}` }
    if (!co) return { ok: false, status: 404, error: "Company not found" }
    if (co.client_profile_id !== profileId) {
      // Deliberately the same wording as an application it does not own. A
      // distinct message would confirm the company exists, which is a fact
      // about someone else's board.
      return { ok: false, status: 403, error: "Not authorized" }
    }
    resolved = { id: co.id as string, name: co.name as string, created: false }
  } else {
    const r = await resolveCompanyByName(supabase, profileId, companyName)
    if ("error" in r) return { ok: false, status: 500, error: r.error }
    resolved = r
  }

  // 3. Write the link, scoped by profile_id as well as id. Belt and braces:
  //    step 1 already proved ownership, and this makes the UPDATE itself unable
  //    to touch another profile's row even if step 1 were ever weakened.
  const { error: updErr } = await supabase
    .from("signal_applications")
    .update({ company_id: resolved.id, updated_at: new Date().toISOString() })
    .eq("id", applicationId)
    .eq("profile_id", profileId)
  if (updErr) return { ok: false, status: 500, error: `Link failed: ${updErr.message}` }

  return { ok: true, companyId: resolved.id, companyName: resolved.name, created: resolved.created }
}
