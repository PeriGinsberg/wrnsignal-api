"use client"

// Network Tracker — COMPANIES as a board (Phase 5b), grouped by tier.
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
import { T, headline, btnPrimary, input, select as selectStyle, selectOption, fieldLabel, fieldWrap } from "../../../../lib/dashboard-theme"
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
    <main style={{ padding: "22px 26px 60px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
        <h1 style={headline}>{VIEW_LABELS.companies.heading}</h1>
        {standaloneCount !== null && standaloneCount > 0 && (
          <Link
            href="/dashboard/network/contacts?standalone=1"
            style={{ color: T.WRN_BLUE, fontSize: 12, fontWeight: 700, textDecoration: "none" }}
          >
            {standaloneCount} standalone contact{standaloneCount === 1 ? "" : "s"} →
          </Link>
        )}
      </div>

      {banner && (
        <div style={{ marginTop: 12, padding: "9px 12px", borderRadius: 10, background: T.GLASS, border: `1px solid ${T.BORDER_SOFT}`, color: T.TEXT, fontSize: 12 }}>
          {banner}
          <button onClick={() => setBanner(null)} style={{ background: "none", border: "none", color: T.DIM, cursor: "pointer", float: "right" }}>×</button>
        </div>
      )}

      <AddCompanyForm onAdded={(c) => setCompanies((prev) => [...prev, c])} />

      {error && <div style={{ color: T.ERROR, fontSize: 13, marginTop: 16 }}>{error}</div>}
      {loading && <div style={{ color: T.DIM, fontSize: 13, marginTop: 16 }}>Loading…</div>}

      {!loading && companies.length === 0 && !error && (
        <div style={{ marginTop: 18, padding: "32px 24px", textAlign: "center", border: `1px dashed ${T.BORDER_SOFT}`, borderRadius: 14, color: T.MUTED, fontSize: 13 }}>
          No companies yet. Add a target firm — you don&apos;t need a contact there first.
        </div>
      )}

      {TIER_ORDER.map((tier) => {
        const rows = grouped.get(tier) ?? []
        if (rows.length === 0) return null
        return (
          <section key={tier} style={{ marginTop: 22 }}>
            <h2 style={{ color: T.DIM, fontSize: 10, fontWeight: 900, letterSpacing: 0.5, textTransform: "uppercase", margin: "0 0 8px" }}>
              {TIER_GROUP_LABELS[tier]} · {rows.length}
            </h2>
            {rows.map((c) => (
              <CompanyCard
                key={c.id}
                company={c}
                onChanged={(patch) => applyPatch(c.id, patch)}
                onRequestDelete={() => setDeleting(c)}
              />
            ))}
          </section>
        )
      })}

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
      <button onClick={() => setOpen(true)} style={{ ...btnPrimary, marginTop: 14, padding: "9px 14px", fontSize: 12 }}>
        Add a company
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
        style={{ ...input, height: 36, fontSize: 12, width: 240 }}
      />
      <label style={fieldWrap}>
        <span style={fieldLabel}>{FIELD_LABELS.tier}</span>
      <select value={tier} onChange={(e) => setTier(e.target.value)} aria-label={FIELD_LABELS.tier} style={{ ...selectStyle, width: "auto", height: 36, fontSize: 12 }}>
        <option value="" style={selectOption}>{TIER_GROUP_LABELS[UNSORTED_TIER]}</option>
        {Object.entries(TIER_LABELS).map(([k, v]) => <option key={k} value={k} style={selectOption}>{v}</option>)}
      </select>
      </label>
      <button onClick={() => void submit()} disabled={busy || !name.trim()} style={{ ...btnPrimary, padding: "9px 14px", fontSize: 12 }}>
        {busy ? "Adding…" : "Add"}
      </button>
      <button onClick={() => { setOpen(false); setErr(null) }} style={{ background: "none", border: "none", color: T.DIM, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
        Cancel
      </button>
      {err && <div style={{ color: T.ERROR, fontSize: 11, width: "100%" }}>{err}</div>}
    </div>
  )
}
