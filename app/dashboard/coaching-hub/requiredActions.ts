// Required Actions types and the sourced-jobs provider, shared by the Coaching
// Hub page and its test.

import type { PlanGroup } from "./page"

export type RequiredAction = {
  id: string
  kind: string
  label: string
  title: string
  subtitle: string | null
  note: string | null
  decision: string | null
  score: number | null
  href: string
  sentAt: string | null
  context?: string
  doneEndpoint?: string
}

export type ProviderContext = { token: string; groups: PlanGroup[] }

export type ActionProvider = {
  kind: string
  load: (ctx: ProviderContext) => Promise<RequiredAction[]>
}

// Provider: unreviewed coach-sourced jobs. Reuses the existing client endpoint
// /api/coach/my-recommendations (returns all recs for this client); keep only
// the unanswered ones that have a tracker job to open.
// Lives outside page.tsx so RequiredActionsLink.test.tsx can import it: a
// Next page may only export its default and route config.
export const unreviewedSourcedJobs: ActionProvider = {
  kind: "sourced_job",
  load: async ({ token }) => {
    const res = await fetch("/api/coach/my-recommendations", { headers: { Authorization: `Bearer ${token}` } })
    const j = await res.json().catch(() => ({}))
    if (!res.ok || !j?.ok) throw new Error(j?.error || `Couldn't load recommendations (${res.status})`)
    return (j.recommendations || [])
      .filter((r: any) => r.client_status === "new" && r.application_id)
      .map((r: any) => ({
        id: r.id,
        kind: "sourced_job",
        label: "Review the job your coach sent",
        title: r.job_title || "Untitled role",
        subtitle: r.company_name || null,
        note: r.coaching_note || null,
        decision: r.signal_decision || null,
        score: typeof r.signal_score === "number" ? r.signal_score : null,
        // Straight to the job. It used to go to /dashboard/tracker?job={id},
        // which the tracker then client-side redirected to the detail route —
        // the same one-hop indirection removed from the Dashboard nudges.
        href: `/dashboard/tracker/${r.application_id}`,
        sentAt: r.created_at || null,
      }))
  },
}
