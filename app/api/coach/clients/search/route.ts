// app/api/coach/clients/search/route.ts
//
// GET ?q=<at least 2 characters>: the caller's clients whose first or last name
// starts with what was typed (lib/coach/clientSearch.ts), at most 8, each with
// the href of its existing detail page. Nothing is returned for a shorter query:
// the dashboard never lists the whole roster.
//
// Whose clients: the caller's own and, for a delegate, her principal's
// (resolveCoach -> actingIds), on an active relationship, the same scope as
// the dashboard's My Clients and the Clients page. Prospects are excluded:
// they have their own page.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { errStatus, getSupabaseAdmin, resolveCoach } from "../../../_lib/coachEngagements"
import { MIN_QUERY, clientHref, searchClients } from "@/lib/coach/clientSearch"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { delegation, error } = await resolveCoach(req)
    if (error) return error
    const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 80)
    if (q.trim().length < MIN_QUERY) return withCorsJson(req, { ok: true, clients: [] })

    const db = getSupabaseAdmin()
    const { data: rels, error: relErr } = await db.from("coach_clients")
      .select("id, name, client_profile_id, invited_email, lifecycle_status")
      .in("coach_profile_id", delegation.actingIds)
      .eq("status", "active")
    if (relErr) throw new Error(`Failed to read clients: ${relErr.message}`)
    const rows = ((rels ?? []) as { id: string; name: string | null; client_profile_id: string | null; invited_email: string | null; lifecycle_status: string | null }[])
      .filter((r) => r.lifecycle_status !== "Prospect")

    // Names: the relationship's own, else the linked profile's.
    const profileIds = rows.filter((r) => r.client_profile_id).map((r) => r.client_profile_id as string)
    const names = new Map<string, string>()
    if (profileIds.length) {
      const { data: profs } = await db.from("client_profiles").select("id, name").in("id", profileIds)
      for (const p of (profs ?? []) as { id: string; name: string | null }[]) if (p.name?.trim()) names.set(p.id, p.name.trim())
    }

    // One entry per person: a client shared by two coaches in the same practice
    // has two relationships but one detail page.
    const seen = new Set<string>()
    const people: { id: string; name: string; client_profile_id: string | null }[] = []
    for (const r of rows) {
      const name = r.name?.trim() || (r.client_profile_id && names.get(r.client_profile_id)) || ""
      if (!name) continue
      const key = r.client_profile_id ?? r.id
      if (seen.has(key)) continue
      seen.add(key)
      people.push({ id: r.id, name, client_profile_id: r.client_profile_id })
    }

    const clients = searchClients(people, q).map((c) => ({ id: c.id, name: c.name, href: clientHref(c) }))
    return withCorsJson(req, { ok: true, clients })
  } catch (e) {
    return withCorsJson(req, { ok: false, error: e instanceof Error ? e.message : String(e) }, errStatus(e))
  }
}
