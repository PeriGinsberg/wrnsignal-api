"use client"

// The dashboard's nudges, in their own module.
//
// IT LIVES HERE BECAUSE A PAGE FILE MAY NOT EXPORT IT. Next 16 rejects any
// non-page export from a route file, so `export function Nudges` inside
// page.tsx was a build failure waiting for the route types to be regenerated:
// stale types hid it locally, and a clean checkout would not have been so
// forgiving.
//
// It was exported in the first place for Nudges.test.tsx, and that reason still
// holds. The page fetches its own data, so testing these links through the
// default export would mean mocking three endpoints to assert on an href.
// Extracting the component is the fix the test wanted anyway.
//
// Specific, never vague. Each nudge names the person or the company.

import { LIGHT as S, surfaceCard } from "../../lib/theme/surfaces"
import { timeAgo } from "../../lib/relativeTime"
import { PinIcon, RepliedIcon } from "../../components/icons"
import { type DashboardModel } from "./dashboardState"

export function Nudges({ model }: { model: DashboardModel }) {
  const items: { key: string; icon: React.ReactNode; body: React.ReactNode; href: string; cta: string; tone: "attention" | "replied" }[] = []

  for (const c of model.awaiting.slice(0, 2)) {
    items.push({
      key: `r-${c.id}`, icon: <RepliedIcon size={26} />, tone: "replied",
      body: <><strong>{c.first_name} {c.last_name}</strong> replied {timeAgo(c.last_action_at) ?? "recently"}. Don't leave them hanging.</>,
      href: `/dashboard/network/contacts/${c.id}`, cta: "Reply →",
    })
  }
  for (const a of model.stale.slice(0, 2)) {
    items.push({
      key: `s-${a.id}`, icon: <PinIcon size={26} />, tone: "attention",
      body: <>You applied to <strong>{a.company_name || "a company"}</strong> over two weeks ago with no word back. Worth a follow-up.</>,
      // Straight to THIS job. Same fix as "Prep now" in the hero above: the
      // nudge names a company in its own sentence and then opened the whole
      // tracker, leaving the student to find again the job the screen had
      // just picked out for them. `a.id` is a signal_applications id — the
      // list comes from /api/applications — and is already used for the key.
      href: `/dashboard/tracker/${a.id}`, cta: "Show me →",
    })
  }
  if (items.length === 0) {
    for (const a of model.saved.slice(0, 2)) {
      items.push({
        key: `v-${a.id}`, icon: <PinIcon size={26} />, tone: "attention",
        body: <>You saved <strong>{a.job_title || "a job"}</strong>{a.company_name ? ` at ${a.company_name}` : ""} but haven't applied yet.</>,
        href: `/dashboard/tracker/${a.id}`, cta: "Show me →",
      })
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {items.slice(0, 3).map((it) => (
        <div key={it.key} style={{ ...nudgeCard, borderLeft: `3px solid ${S.meaning[it.tone].accent}` }}>
          <span style={{ flexShrink: 0, display: "flex" }}>{it.icon}</span>
          <span style={{ flex: 1, color: S.text.secondary, fontSize: 15, lineHeight: "22px" }}>{it.body}</span>
          <a href={it.href} style={{ color: S.action.quietInk, fontSize: 14.5, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}>
            {it.cta}
          </a>
        </div>
      ))}
    </div>
  )
}

// The page's `card` plus its own row layout, which is how this rendered when it
// lived there: {...card, ...nudgeCard}. Built from surfaceCard rather than
// copying page.tsx's four colour lines, so the two cannot drift apart.
const nudgeCard: React.CSSProperties = {
  ...surfaceCard(S),
  borderRadius: 14,
  display: "flex", alignItems: "center", gap: 14, padding: "16px 20px",
}
