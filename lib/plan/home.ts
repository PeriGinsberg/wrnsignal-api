// lib/plan/home.ts
//
// The plan's two Coach Home blocks (the third, My active tasks, is the To-Do
// list itself):
//
//   followUps       client tasks released 3 or more days ago and still Waiting
//                   on client, oldest first
//   clientsByPhase  for each of the coach's phases, the clients with it In
//                   progress (a client with two phases In progress is under
//                   both); clients with none In progress are under "Not
//                   started"
//
// For the coach's own clients (and a delegate's principal's), not prospects.

import type { SupabaseClient } from "@supabase/supabase-js"
import { planLink } from "./todo"

export const FOLLOW_UP_DAYS = 3
const DAY = 24 * 60 * 60 * 1000

export type FollowUp = {
  task_id: string
  task: string
  client: string
  href: string
  released_at: string
  days_waiting: number
}
export type PhaseBucket = {
  key: string
  label: string
  clients: { coach_client_id: string; name: string; href: string }[]
}

type Rel = { id: string; name: string | null; client_profile_id: string | null; coach_profile_id: string }

export async function getHomeBlocks(
  db: SupabaseClient,
  coachIds: string[],
  now = new Date(),
): Promise<{ followUps: FollowUp[]; clientsByPhase: PhaseBucket[] }> {
  const { data: rels, error } = await db.from("coach_clients")
    .select("id, name, client_profile_id, coach_profile_id, lifecycle_status")
    .in("coach_profile_id", coachIds).eq("status", "active")
  if (error) throw new Error(`Failed to read clients: ${error.message}`)
  const clients = ((rels ?? []) as (Rel & { lifecycle_status: string | null })[]).filter((r) => r.lifecycle_status !== "Prospect")
  if (!clients.length) return { followUps: [], clientsByPhase: [] }

  // Names: the relationship's own, else the linked profile's.
  const profIds = clients.filter((c) => !c.name && c.client_profile_id).map((c) => c.client_profile_id as string)
  const names = new Map<string, string>()
  if (profIds.length) {
    const { data } = await db.from("client_profiles").select("id, name, email").in("id", profIds)
    for (const p of (data ?? []) as { id: string; name: string | null; email: string | null }[]) names.set(p.id, p.name || p.email || "Unnamed")
  }
  const nameOf = (c: Rel) => c.name?.trim() || (c.client_profile_id && names.get(c.client_profile_id)) || "Unnamed"
  const hrefOf = (c: Rel) => planLink({ coach_client_id: c.id, client_profile_id: c.client_profile_id })
  const byId = new Map(clients.map((c) => [c.id, c]))

  // The approved plan: packages, deliverables still needed, their tasks.
  const { data: engs } = await db.from("coach_client_engagements").select("id, coach_client_id")
    .in("coach_client_id", clients.map((c) => c.id)).eq("proposal_status", "approved")
  const engClient = new Map(((engs ?? []) as { id: string; coach_client_id: string }[]).map((e) => [e.id, e.coach_client_id]))
  const delivs: { id: string; engagement_id: string; phase_id: string | null }[] = []
  if (engClient.size) {
    const { data } = await db.from("coach_client_engagement_deliverables").select("id, engagement_id, phase_id, not_needed")
      .in("engagement_id", [...engClient.keys()])
    delivs.push(...((data ?? []) as (typeof delivs[number] & { not_needed: boolean })[]).filter((d) => !d.not_needed))
  }
  const delivClient = new Map(delivs.map((d) => [d.id, engClient.get(d.engagement_id)!]))

  // Follow-ups due.
  const followUps: FollowUp[] = []
  if (delivs.length) {
    const cutoff = new Date(now.getTime() - FOLLOW_UP_DAYS * DAY).toISOString()
    const { data } = await db.from("coach_client_engagement_activities").select("id, name, engagement_deliverable_id, released_at")
      .in("engagement_deliverable_id", delivs.map((d) => d.id)).eq("state", "waiting_on_client").lte("released_at", cutoff)
    for (const a of (data ?? []) as { id: string; name: string; engagement_deliverable_id: string; released_at: string }[]) {
      const c = byId.get(delivClient.get(a.engagement_deliverable_id) ?? "")
      if (!c) continue
      followUps.push({
        task_id: a.id, task: a.name, client: nameOf(c), href: hrefOf(c), released_at: a.released_at,
        days_waiting: Math.floor((now.getTime() - new Date(a.released_at).getTime()) / DAY),
      })
    }
    followUps.sort((a, b) => a.released_at.localeCompare(b.released_at))
  }

  // Clients by phase. A phase is In progress for a client only while it is in
  // their plan (a needed deliverable in an approved package has it).
  const { data: phaseRows } = await db.from("coach_phases").select("id, label, sort_order, active, coach_profile_id")
    .in("coach_profile_id", [...new Set(clients.map((c) => c.coach_profile_id))]).eq("active", true)
  const phases = ((phaseRows ?? []) as { id: string; label: string; sort_order: number }[]).sort((a, b) => a.sort_order - b.sort_order)
  const inPlan = new Set(delivs.filter((d) => d.phase_id).map((d) => `${delivClient.get(d.id)}|${d.phase_id}`))
  const { data: statusRows } = await db.from("client_phase_status").select("coach_client_id, phase_id, status")
    .in("coach_client_id", clients.map((c) => c.id)).eq("status", "in_progress")
  const inProgress = ((statusRows ?? []) as { coach_client_id: string; phase_id: string }[])
    .filter((r) => inPlan.has(`${r.coach_client_id}|${r.phase_id}`))

  const entry = (c: Rel) => ({ coach_client_id: c.id, name: nameOf(c), href: hrefOf(c) })
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)
  const buckets: PhaseBucket[] = phases.map((p) => ({
    key: p.id,
    label: p.label,
    clients: inProgress.filter((r) => r.phase_id === p.id).flatMap((r) => { const c = byId.get(r.coach_client_id); return c ? [entry(c)] : [] }).sort(byName),
  }))
  const started = new Set(inProgress.map((r) => r.coach_client_id))
  buckets.push({ key: "not_started", label: "Not started", clients: clients.filter((c) => !started.has(c.id)).map(entry).sort(byName) })
  return { followUps, clientsByPhase: buckets }
}
