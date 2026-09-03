"use client"

// The metrics half of the Dashboard view (Phase 9). Sits BELOW the worklist — the founding
// rule is that the due list is the product, so a user sees who to contact before
// they see a single number.
//
// Everything is computed client-side from the contacts list (dashboardMetrics.ts).
// No aggregate route in v1.
//
// Every funnel group and needs-attention row deep-links into Contacts with a
// filter pre-applied. That is what makes the numbers actionable rather than
// decorative — a count you cannot click is a fact you cannot act on.

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { T, PHASE, card, fieldLabel } from "../../../lib/dashboard-theme"
import { authFetch, withSubject } from "./authFetch"
import type { Contact } from "./contacts/ContactRow"
import {
  funnel, conversion, splitBy, weeklyFirstTouches, needsAttention, pct,
  MIN_SPLIT_N, BENCHMARK_MIN_REACHED, STALLED_DAYS, WEEKLY_TARGET_MIN, WEEKLY_TARGET_MAX,
} from "./dashboardMetrics"

// Every link built from this runs through withSubject(), so a coach drilling
// from a panel into the filtered roster stays on the client's board instead of
// silently arriving at their own.
const CONTACTS = "/dashboard/network/contacts"

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ ...card, padding: "16px 18px", marginTop: 14 }}>
      <h2 style={{ ...fieldLabel, textTransform: "uppercase", margin: "0 0 12px" }}>{title}</h2>
      {children}
    </section>
  )
}

export function DashboardPanels({ contacts }: { contacts: Contact[] }) {
  // `now` is state, not a module constant, so the render is stable and testable
  // rather than shifting under a long-lived tab.
  const [now] = useState(() => new Date())

  const groups = useMemo(() => funnel(contacts), [contacts])
  const conv = useMemo(() => conversion(contacts), [contacts])
  const byRel = useMemo(() => splitBy(contacts, "relationship"), [contacts])
  const bySeg = useMemo(() => splitBy(contacts, "segment"), [contacts])
  const week = useMemo(() => weeklyFirstTouches(contacts, now), [contacts, now])
  const attn = useMemo(() => needsAttention(contacts, now), [contacts, now])

  if (contacts.length === 0) return null // nothing to say about an empty board

  const weekPctOfTarget = Math.min(100, (week / WEEKLY_TARGET_MAX) * 100)
  const metTarget = week >= WEEKLY_TARGET_MIN

  return (
    <div data-testid="dashboard-panels">
      {/* 2 — THIS WEEK. Effort, which the client controls, rather than replies,
          which they don't. */}
      <Panel title="This week">
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <span style={{ color: T.TEXT, fontSize: 22, fontWeight: 900 }}>{week}</span>
          <span style={{ color: T.MUTED, fontSize: 13 }}>
            {metTarget
              ? `Target met — ${week} first touch${week === 1 ? "" : "es"} this week`
              : `${week} of ${WEEKLY_TARGET_MIN} first touches this week`}
          </span>
        </div>
        <div style={{ height: 8, borderRadius: 4, background: T.BORDER_SOFT, marginTop: 10, overflow: "hidden" }}>
          <div style={{ width: `${weekPctOfTarget}%`, height: "100%", background: metTarget ? T.SUCCESS : T.WRN_BLUE }} />
        </div>
        <div style={{ color: T.DIM, fontSize: 11, marginTop: 6 }}>
          Target {WEEKLY_TARGET_MIN}–{WEEKLY_TARGET_MAX} new first touches per week.
        </div>
      </Panel>

      {/* 3 — FUNNEL, seven groups, every one clickable. */}
      <Panel title="Pipeline">
        <div style={{ display: "flex", gap: 6, width: "100%" }}>
          {groups.map((g) => (
            <Link
              key={g.phase}
              href={withSubject(`${CONTACTS}?phase=${g.phase}`)}
              data-testid={`funnel-${g.phase}`}
              data-count={g.count}
              style={{ flex: 1, minWidth: 0, textDecoration: "none" }}
            >
              <div style={{ height: 6, borderRadius: 3, background: g.count > 0 ? PHASE[g.phase].fg : T.BORDER_SOFT }} />
              <div style={{ marginTop: 6, fontSize: 17, fontWeight: 900, color: g.count > 0 ? PHASE[g.phase].fg : T.DIM }}>
                {g.count}
              </div>
              <div
                style={{
                  fontSize: 9.5, fontWeight: 700, color: T.MUTED,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}
              >
                {g.label}
              </div>
            </Link>
          ))}
        </div>
      </Panel>

      {/* 4 — CONVERSION. */}
      <Panel title="Conversion">
        <div style={{ display: "flex", gap: 26, flexWrap: "wrap" }}>
          <Stat label="Reached" value={String(conv.reached)} sub={`of ${conv.total} contacts`} />
          <Stat label="Reply rate" value={pct(conv.replyRate)} sub={`${conv.replied} of ${conv.reached} reached`} />
          <Stat label="Chat rate" value={pct(conv.chatRate)} sub={`${conv.chatted} of ${conv.replied} replied`} />
          <Stat label="Outcomes" value={String(conv.outcomeTotal)} sub={conv.outcomes.map((o) => `${o.count} ${o.key}`).join(" · ") || "none yet"} />
        </div>
        {conv.showBenchmark ? (
          <p style={{ color: T.MUTED, fontSize: 11.5, lineHeight: "17px", margin: "12px 0 0" }}>
            Once you&apos;ve reached {BENCHMARK_MIN_REACHED}+ contacts, fewer than 1 reply in 10 after all
            three touches usually means the targeting was too broad — not that the messages were bad.
          </p>
        ) : (
          <p style={{ color: T.DIM, fontSize: 11.5, margin: "12px 0 0" }}>
            Reach {BENCHMARK_MIN_REACHED}+ contacts before reading much into the reply rate — below that it
            swings on a single reply.
          </p>
        )}
      </Panel>

      {/* 5 — WHAT'S WORKING. */}
      <Panel title="What's working">
        <SplitList title="By relationship" rows={byRel} param="relationship" />
        <div style={{ height: 14 }} />
        <SplitList title="By segment" rows={bySeg} param="segment" />
      </Panel>

      {/* 6 — NEEDS ATTENTION, only when non-empty. */}
      {(attn.stalled.length + attn.priorityAIdentified.length + attn.resurfacing.length + attn.noRelationship.length) > 0 && (
        <Panel title="Needs attention">
          <AttnRow n={attn.stalled.length} href={withSubject(`${CONTACTS}?status=stalled`)}
            text={`stalled in outreach for ${STALLED_DAYS}+ days`} />
          <AttnRow n={attn.priorityAIdentified.length} href={withSubject(`${CONTACTS}?priority=A&stage=identified`)}
            text="Priority A, not contacted yet" />
          <AttnRow n={attn.resurfacing.length} href={withSubject(`${CONTACTS}?phase=resting`)}
            text="resting, resurfacing this week" />
          <AttnRow n={attn.noRelationship.length} href={withSubject(`${CONTACTS}?relationship=__none__`)}
            text="with no relationship set" />
        </Panel>
      )}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <div style={fieldLabel}>{label}</div>
      <div style={{ color: T.TEXT, fontSize: 24, fontWeight: 900, lineHeight: "30px" }}>{value}</div>
      <div style={{ color: T.DIM, fontSize: 11 }}>{sub}</div>
    </div>
  )
}

function SplitList({ title, rows, param }: {
  title: string
  rows: { key: string; label: string; reached: number; replied: number; rate: number | null; suppressed: boolean }[]
  param: "relationship" | "segment"
}) {
  return (
    <div>
      <div style={{ ...fieldLabel, marginBottom: 8 }}>{title}</div>
      {rows.length === 0 ? (
        <div style={{ color: T.DIM, fontSize: 12 }}>Nothing set yet.</div>
      ) : (
        rows.map((r) => (
          <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0" }}>
            <Link href={withSubject(`${CONTACTS}?${param}=${encodeURIComponent(r.key)}`)}
              style={{ width: 130, color: T.TEXT, fontSize: 12, fontWeight: 700, textDecoration: "none", flexShrink: 0 }}>
              {r.label}
            </Link>
            <div style={{ flex: 1, height: 6, borderRadius: 3, background: T.BORDER_SOFT, overflow: "hidden", minWidth: 40 }}>
              {!r.suppressed && r.rate != null && (
                <div style={{ width: `${Math.round(r.rate * 100)}%`, height: "100%", background: T.WRN_BLUE }} />
              )}
            </div>
            <div
              data-testid={`split-${param}-${r.key}`}
              data-suppressed={r.suppressed ? "true" : "false"}
              style={{ width: 132, textAlign: "right", fontSize: 11, color: r.suppressed ? T.DIM : T.TEXT, flexShrink: 0 }}
            >
              {/* Under the threshold we show the COUNT and say so, rather than a
                  rate over four contacts that means nothing. */}
              {r.suppressed
                ? `not enough data yet (${r.reached}/${MIN_SPLIT_N})`
                : `${pct(r.rate)} · ${r.replied}/${r.reached}`}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

function AttnRow({ n, href, text }: { n: number; href: string; text: string }) {
  if (n === 0) return null
  return (
    <Link href={href} style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "5px 0", textDecoration: "none" }}>
      <span style={{ color: T.WRN_ORANGE, fontSize: 13, fontWeight: 900 }}>{n}</span>
      <span style={{ color: T.TEXT, fontSize: 12.5 }}>{text}</span>
      <span style={{ color: T.DIM, fontSize: 11 }}>→</span>
    </Link>
  )
}

/** Fetches the contacts list itself so the worklist page stays a worklist. */
export function DashboardSection() {
  const [contacts, setContacts] = useState<Contact[]>([])
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await authFetch("/api/network/contacts")
        const j = await res.json().catch(() => ({}))
        if (alive && res.ok && j?.ok) setContacts(j.contacts ?? [])
      } catch {
        // Metrics are secondary to the worklist above — a failure here stays silent
        // rather than putting an error banner over the thing that matters.
      }
    })()
    return () => { alive = false }
  }, [])
  return <DashboardPanels contacts={contacts} />
}
