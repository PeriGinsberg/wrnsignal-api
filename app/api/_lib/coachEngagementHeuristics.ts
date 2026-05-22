// app/api/_lib/coachEngagementHeuristics.ts
//
// Shared engagement-signal heuristic engine used by:
//   - /api/coach/home          cross-client view (all of a coach's clients)
//   - /api/coach/clients/[id]/needs-attention   per-client view
//
// Extracted from /api/coach/home/route.ts in Phase 3 Commit 3.0 so both
// surfaces share one source of truth. Behavior is identical to the prior
// inline implementation — same SQL queries, same rule thresholds, same
// output shape. The only public API change is that the engine is now
// parameterized on a list of HeuristicClient inputs, which each caller
// assembles before invoking.
//
// Rules:
//   R1 no_login          client hasn't logged in 7+ days
//   R2 rec_pending_review coach rec pending client response 3+ days
//   R3 moved_interviewing app moved to 'interviewing' 2+ days ago, no
//                         coach view since the transition
//   R4 moved_rejected     app moved to 'rejected' 3+ days ago, no coach
//                         view since
//   R5 offer_no_followup  app has an offer 1+ day old, no coach view since
//   R6 poor_fit_no_rec    poor-fit app (signal_score<60) added 5+ days
//                         ago with no coach rec from this coach
//
// Per-rule dedup: at most one item per (client_profile_id, kind) pair.
// Sort: oldest issues first (days_elapsed DESC), then by client_name ASC
// for stability.

import type { SupabaseClient } from "@supabase/supabase-js"

export type EngagementSignalKind =
  | "no_login"
  | "rec_pending_review"
  | "moved_interviewing"
  | "moved_rejected"
  | "offer_no_followup"
  | "poor_fit_no_rec"

export type EngagementSignal = {
  id: string
  kind: EngagementSignalKind
  client_profile_id: string
  client_name: string
  message: string
  days_elapsed: number
}

// Minimum per-client shape the heuristic engine needs as input. Each
// caller is responsible for assembling this from the coach_clients +
// client_profiles join (whatever subset of clients applies to that
// surface).
export type HeuristicClient = {
  client_profile_id: string
  name: string | null
  email: string | null
  user_id: string | null
  last_viewed_at: string | null
}

const MS_DAY = 24 * 60 * 60 * 1000
const daysAgoIso = (d: number): string => new Date(Date.now() - d * MS_DAY).toISOString()
const daysBetween = (iso: string): number =>
  Math.floor((Date.now() - new Date(iso).getTime()) / MS_DAY)

export type RunHeuristicsOptions = {
  supabase: SupabaseClient
  coachProfileId: string
  clients: HeuristicClient[]
}

export async function runHeuristics(
  opts: RunHeuristicsOptions,
): Promise<EngagementSignal[]> {
  const { supabase, coachProfileId, clients } = opts

  const signals: EngagementSignal[] = []
  const seenClientRule = new Set<string>()
  const push = (item: EngagementSignal) => {
    const key = `${item.client_profile_id}:${item.kind}`
    if (seenClientRule.has(key)) return
    seenClientRule.add(key)
    signals.push(item)
  }

  if (clients.length === 0) return signals
  const clientProfileIds = clients.map((c) => c.client_profile_id)

  // R1 — client hasn't logged in 7+ days. auth.users.last_sign_in_at via
  // admin API (per-user lookup).
  for (const c of clients) {
    if (!c.user_id) continue
    try {
      const { data: u } = await supabase.auth.admin.getUserById(c.user_id)
      const last = u?.user?.last_sign_in_at
      if (!last) continue
      const days = daysBetween(last)
      if (days >= 7) {
        push({
          id: `r1:${c.client_profile_id}`,
          kind: "no_login",
          client_profile_id: c.client_profile_id,
          client_name: c.name || c.email || "(unknown)",
          message: `${(c.name || c.email || "Client").split(" ")[0]} hasn't logged in for ${days} days`,
          days_elapsed: days,
        })
      }
    } catch {
      // auth lookup errors are non-fatal — skip the rule for this client
    }
  }

  // R2 — coach rec pending client review 3+ days
  {
    const { data: stale } = await supabase
      .from("coach_job_recommendations")
      .select("id, client_profile_id, created_at")
      .eq("coach_profile_id", coachProfileId)
      .in("client_profile_id", clientProfileIds)
      .is("client_responded_at", null)
      .lt("created_at", daysAgoIso(3))
      .order("created_at", { ascending: true })
    for (const rec of stale || []) {
      const c = clients.find((x) => x.client_profile_id === rec.client_profile_id)
      if (!c) continue
      const days = daysBetween(rec.created_at as string)
      push({
        id: `r2:${rec.id}`,
        kind: "rec_pending_review",
        client_profile_id: rec.client_profile_id as string,
        client_name: c.name || c.email || "(unknown)",
        message: `${(c.name || c.email || "Client").split(" ")[0]} — coach rec pending review for ${days} days`,
        days_elapsed: days,
      })
    }
  }

  // R3, R4, R5 — status-history-driven (interviewing / rejected / offer).
  // Pull all relevant transitions in one shot, then verify the transition
  // is STILL the current status (nothing moved past it).
  {
    const { data: histRows } = await supabase
      .from("signal_applications_status_history")
      .select("id, application_id, to_status, changed_at, signal_applications!inner(profile_id, company_name, job_title)")
      .in("to_status", ["interviewing", "rejected", "offer"])
      .in("signal_applications.profile_id", clientProfileIds)
      .order("changed_at", { ascending: false })

    type Hist = {
      id: string
      application_id: string
      to_status: string
      changed_at: string
      client_profile_id: string
      company_name: string
      job_title: string
    }
    const latestPerClient = new Map<string, Hist>()
    for (const r of (histRows || []) as any[]) {
      const cpid = r.signal_applications?.profile_id
      if (!cpid) continue
      const key = `${cpid}:${r.to_status}:${r.application_id}`
      if (!latestPerClient.has(key)) {
        latestPerClient.set(key, {
          id: r.id,
          application_id: r.application_id,
          to_status: r.to_status,
          changed_at: r.changed_at,
          client_profile_id: cpid,
          company_name: r.signal_applications?.company_name ?? "",
          job_title: r.signal_applications?.job_title ?? "",
        })
      }
    }

    const candidateAppIds = Array.from(latestPerClient.values()).map((h) => h.application_id)
    const currentStatusByApp = new Map<string, string>()
    if (candidateAppIds.length > 0) {
      const { data: currentApps } = await supabase
        .from("signal_applications")
        .select("id, application_status")
        .in("id", candidateAppIds)
      for (const a of currentApps || []) currentStatusByApp.set(a.id as string, a.application_status as string)
    }

    const baselineThresholds: Record<string, number> = {
      interviewing: 2,
      rejected: 3,
      offer: 1,
    }
    const ruleByStatus: Record<string, EngagementSignalKind> = {
      interviewing: "moved_interviewing",
      rejected: "moved_rejected",
      offer: "offer_no_followup",
    }

    for (const h of latestPerClient.values()) {
      // Status must still be the same (i.e. they didn't move past it)
      if (currentStatusByApp.get(h.application_id) !== h.to_status) continue

      const days = daysBetween(h.changed_at)
      const threshold = baselineThresholds[h.to_status]
      if (days < threshold) continue

      // No coach view since the change
      const c = clients.find((x) => x.client_profile_id === h.client_profile_id)
      if (!c) continue
      if (c.last_viewed_at && c.last_viewed_at > h.changed_at) continue

      const first = (c.name || c.email || "Client").split(" ")[0]
      const co = h.company_name || "an application"
      const messages: Record<string, string> = {
        interviewing: `${first} moved ${co} to Interviewing ${days} days ago — no follow-up`,
        rejected: `${first} was rejected from ${co} ${days} days ago — no acknowledgment`,
        offer: `${first} has an offer from ${co} (${days}d) — needs follow-up`,
      }
      push({
        id: `${ruleByStatus[h.to_status]}:${h.application_id}`,
        kind: ruleByStatus[h.to_status],
        client_profile_id: h.client_profile_id,
        client_name: c.name || c.email || "(unknown)",
        message: messages[h.to_status],
        days_elapsed: days,
      })
    }
  }

  // R6 — poor-fit app added 5+ days ago with no coach rec from this coach
  {
    const { data: poorFit } = await supabase
      .from("signal_applications")
      .select("id, profile_id, company_name, job_title, signal_score, created_at, application_status")
      .in("profile_id", clientProfileIds)
      .not("signal_score", "is", null)
      .lt("signal_score", 60)
      .lt("created_at", daysAgoIso(5))
      .not("application_status", "in", "(rejected,withdrawn)")

    const { data: coachRecs } = await supabase
      .from("coach_job_recommendations")
      .select("client_profile_id, company_name, job_title")
      .eq("coach_profile_id", coachProfileId)
      .in("client_profile_id", clientProfileIds)
    const recKey = (cpid: string, co: string, ti: string) =>
      `${cpid}|${(co || "").toLowerCase().trim()}|${(ti || "").toLowerCase().trim()}`
    const recSet = new Set(
      (coachRecs || []).map((r: any) => recKey(r.client_profile_id, r.company_name, r.job_title)),
    )

    for (const a of poorFit || []) {
      const cpid = a.profile_id as string
      const co = a.company_name as string
      const ti = a.job_title as string
      if (recSet.has(recKey(cpid, co, ti))) continue
      const c = clients.find((x) => x.client_profile_id === cpid)
      if (!c) continue
      const days = daysBetween(a.created_at as string)
      const first = (c.name || c.email || "Client").split(" ")[0]
      push({
        id: `r6:${a.id}`,
        kind: "poor_fit_no_rec",
        client_profile_id: cpid,
        client_name: c.name || c.email || "(unknown)",
        message: `${first} added ${co || "a low-fit app"} (score ${a.signal_score}) ${days}d ago — no coach rec yet`,
        days_elapsed: days,
      })
    }
  }

  // Sort: oldest issues first (highest days_elapsed), then by client_name
  // ASC for stability. Matches the prior /api/coach/home behavior exactly.
  signals.sort((a, b) => {
    if (b.days_elapsed !== a.days_elapsed) return b.days_elapsed - a.days_elapsed
    return a.client_name.localeCompare(b.client_name)
  })

  return signals
}
