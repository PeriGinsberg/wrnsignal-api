"use client"

// Network Tracker — COMPANIES as a board, grouped by tier.
//
// Redesign step 5 (2026-08-04): light theme. Structure unchanged; the company
// hub page from the mockups is deliberately NOT built here, because the two
// things that make it its own page (the linked application and the JobFit
// guidance with its LinkedIn searches) both come from the merge and land in
// Phase B. Building a thin hub now would mean gutting it then.
// Zero-contact wishlist firms are first-class here: a dream employer you have no
// way into yet is precisely what this view exists to surface, and it appears
// nowhere else in the tracker.
//
// Grouping is by `tier`, which is nullable — so there is always an "Unsorted"
// group ("Not Categorized"), and it sits FIRST. An untiered company is
// untriaged, not low-value;
// bottom placement would bury it permanently. Same reasoning as no-activity
// contacts floating to the top of the roster.

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { LIGHT as S, action as actionStyle } from "../../../../lib/theme/surfaces"
import { authFetch } from "../authFetch"
import { TIER_ORDER, TIER_GROUP_LABELS, TIER_LABELS, UNSORTED_TIER, FIELD_LABELS, VIEW_LABELS } from "../vocab"
import { CompanyCard, type Company } from "./CompanyCard"
import { DeleteCompanyConfirm } from "./DeleteCompanyConfirm"

export default function CompaniesBoardPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [standaloneCount, setStandaloneCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Company | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await authFetch("/api/network/companies")
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Could not load companies (${res.status})`)
      setCompanies(j.companies ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
      setCompanies([])
    } finally {
      setLoading(false)
    }
  }, [])

  // Standalone count for the header link. Separate call because it is a property
  // of the CONTACTS table, not the company board — the companies route has no
  // sensible place to report "contacts belonging to no company".
  const loadStandalone = useCallback(async () => {
    try {
      const res = await authFetch("/api/network/contacts?standalone=1")
      const j = await res.json().catch(() => ({}))
      if (res.ok && j?.ok) setStandaloneCount((j.contacts ?? []).length)
    } catch {
      // Non-critical: the board is still usable without the count.
    }
  }, [])

  useEffect(() => { void load(); void loadStandalone() }, [load, loadStandalone])

  const grouped = useMemo(() => {
    const m = new Map<string, Company[]>(TIER_ORDER.map((t) => [t, []]))
    for (const c of companies) m.get(c.tier ?? UNSORTED_TIER)?.push(c)
    return m
  }, [companies])

  /**
   * The board as ONE flat, ordered list: a heading, then its cards, then the
   * next heading. Grouping is still by tier and reads identically; what changes
   * is that grouping is now expressed by POSITION rather than by nesting, so
   * every card has the same parent and keeps its identity when its tier changes.
   * See the render for why that matters.
   */
  type BoardItem =
    | { kind: "heading"; tier: string; count: number }
    | { kind: "card"; company: Company }

  const ordered = useMemo(() => {
    const out: BoardItem[] = []
    for (const tier of TIER_ORDER) {
      const rows = grouped.get(tier) ?? []
      if (rows.length === 0) continue // an empty tier still shows no heading
      out.push({ kind: "heading", tier, count: rows.length })
      for (const c of rows) out.push({ kind: "card", company: c })
    }
    return out
  }, [grouped])

  function applyPatch(id: string, patch: Partial<Company>) {
    setCompanies((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  async function runDelete() {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      const res = await authFetch(`/api/network/companies/${deleting.id}`, { method: "DELETE" })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Remove failed (${res.status})`)
      const n = j.contacts_released ?? 0
      setCompanies((prev) => prev.filter((c) => c.id !== deleting.id))
      setBanner(
        n > 0
          ? `Removed ${deleting.name}. ${n} contact${n === 1 ? "" : "s"} kept as standalone.`
          : `Removed ${deleting.name}.`,
      )
      setDeleting(null)
      void loadStandalone() // released contacts change the standalone count
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <main style={{ maxWidth: 1080 }}>
      <div style={eyebrowStyle}>Networking</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
        <h1 style={h1Style}>{VIEW_LABELS.companies.heading}</h1>
        {standaloneCount !== null && standaloneCount > 0 && (
          <Link
            href="/dashboard/network/contacts?standalone=1"
            style={{ color: S.action.quietInk, fontSize: 14, fontWeight: 700, textDecoration: "none" }}
          >
            {standaloneCount} standalone contact{standaloneCount === 1 ? "" : "s"} →
          </Link>
        )}
      </div>

      {banner && (
        <div style={{ marginTop: 16, padding: "12px 16px", borderRadius: 12, background: S.card, border: `1px solid ${S.borderSoft}`, boxShadow: S.shadow.card, color: S.text.primary, fontSize: 14 }}>
          {banner}
          <button onClick={() => setBanner(null)} aria-label="Dismiss" style={{ background: "none", border: "none", color: S.text.dim, fontSize: 18, cursor: "pointer", float: "right", fontFamily: "inherit" }}>×</button>
        </div>
      )}

      <AddCompanyForm onAdded={(c) => setCompanies((prev) => [...prev, c])} />

      {error && <div style={{ color: S.meaning.error.ink, fontSize: 14, marginTop: 18 }}>{error}</div>}
      {loading && <div style={{ color: S.text.muted, fontSize: 14, marginTop: 18 }}>Loading…</div>}

      {!loading && companies.length === 0 && !error && (
        <div style={{ marginTop: 20, padding: "36px 28px", textAlign: "center", border: `1px dashed ${S.border}`, borderRadius: 14, background: "rgba(255,255,255,0.5)", color: S.text.muted, fontSize: 14.5 }}>
          No companies yet. Add a target firm — you don&apos;t need a contact there first.
        </div>
      )}

      {/* ONE PARENT FOR EVERY CARD, headings as siblings between them.

          This used to be a <section> per tier with the cards nested inside, and
          that shape had a bug with teeth: React's keys are only stable WITHIN a
          parent. Setting a company's tier moves it to a different bucket, so the
          card was rendered under a different <section>, and React unmounted the
          old instance and mounted a fresh one. The card owns its expansion and
          its lazily-loaded contacts (CompanyCard's useState), so saving a tier
          slammed the editor shut and threw away the contact list — indis-
          tinguishable, to the person typing, from being thrown back to the board.
          A tester lost her place doing exactly this: tier, then domain, then
          notes, ejected after the first.

          Flattened, every card is a sibling in one list, so a tier change is a
          MOVE within that list. React re-parents nothing, and the open card keeps
          its state and its already-fetched contacts.

          The wrapper renders unconditionally — a conditional parent would
          reintroduce the same remount the moment the list emptied. */}
      <div>
        {ordered.map((item) =>
          item.kind === "heading" ? (
            // Keyed on the tier, and it cannot collide with a card key: those are
            // company uuids.
            <h2
              key={`tier-${item.tier}`}
              style={{
                color: S.text.muted, fontSize: 12, fontWeight: 800, letterSpacing: 1.4,
                textTransform: "uppercase", margin: "22px 0 10px",
              }}
            >
              {TIER_GROUP_LABELS[item.tier]} · {item.count}
            </h2>
          ) : (
            <CompanyCard
              key={item.company.id}
              company={item.company}
              onChanged={(patch) => applyPatch(item.company.id, patch)}
              onRequestDelete={() => setDeleting(item.company)}
            />
          ),
        )}
      </div>

      {deleting && (
        <DeleteCompanyConfirm
          name={deleting.name}
          contactCount={deleting.contact_count}
          busy={deleteBusy}
          onCancel={() => setDeleting(null)}
          onConfirm={runDelete}
        />
      )}
    </main>
  )
}

// Add a company with no contact required — the wishlist entry point.
function AddCompanyForm({ onAdded }: { onAdded: (c: Company) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [tier, setTier] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    if (!name.trim()) return
    setBusy(true)
    setErr(null)
    try {
      const res = await authFetch("/api/network/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), tier: tier || null }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Add failed (${res.status})`)
      onAdded(j.company)
      setName(""); setTier(""); setOpen(false)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{ ...actionStyle(S, "primary"), ...btnSize, marginTop: 18 }}>
        + Add a company
      </button>
    )
  }

  return (
    <div style={{ marginTop: 14, display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void submit()}
        placeholder="Company name"
        aria-label="Company name"
        autoFocus
        style={{ ...control, width: 260 }}
      />
      <label style={fieldWrap}>
        <span style={fieldLabel}>{FIELD_LABELS.tier}</span>
      <select value={tier} onChange={(e) => setTier(e.target.value)} aria-label={FIELD_LABELS.tier} style={{ ...control, width: "auto" }}>
        <option value="">{TIER_GROUP_LABELS[UNSORTED_TIER]}</option>
        {Object.entries(TIER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      </label>
      <button onClick={() => void submit()} disabled={busy || !name.trim()} style={{ ...actionStyle(S, "primary"), ...btnSize, opacity: busy || !name.trim() ? 0.5 : 1 }}>
        {busy ? "Adding…" : "Add"}
      </button>
      <button onClick={() => { setOpen(false); setErr(null) }} style={{ background: "none", border: "none", color: S.action.quietInk, fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
        Cancel
      </button>
      {err && <div style={{ color: S.meaning.error.ink, fontSize: 13, width: "100%" }}>{err}</div>}
    </div>
  )
}

const eyebrowStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 800, letterSpacing: 1.4, textTransform: "uppercase",
  color: S.meaning.replied.ink, marginBottom: 6,
}
const h1Style: React.CSSProperties = {
  fontSize: 34, fontWeight: 800, letterSpacing: -0.6, color: S.text.primary, margin: 0,
}
const btnSize: React.CSSProperties = {
  borderRadius: 10, padding: "12px 20px", fontSize: 14.5, fontFamily: "inherit",
}
const control: React.CSSProperties = {
  background: S.card, border: `1px solid ${S.border}`, borderRadius: 10,
  height: 42, padding: "0 12px", fontSize: 14, color: S.text.primary,
  fontFamily: "inherit", boxSizing: "border-box",
}
const fieldWrap: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 6 }
const fieldLabel: React.CSSProperties = {
  color: S.text.muted, fontSize: 11, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase",
}
