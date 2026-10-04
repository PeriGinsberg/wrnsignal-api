"use client"

// The SOW panel on one proposal (a draft or sent package) on the Engagements
// tab: the coach's opening paragraph for this client, an optional price for
// this client, and the payment terms; then a preview of the SOW exactly as the
// client will see it. GET/PUT .../engagements/[engagement_id]/sow; the rules
// are in lib/sow/client.ts and lib/sow/build.ts. Amounts travel in cents.

import { useCallback, useEffect, useMemo, useState } from "react"
import { T, btnPrimary } from "../../../../../lib/dashboard-theme"
import { TYPE } from "../../../../../lib/theme/surfaces"
import { getSupabaseBrowser } from "../../../../../lib/supabase-browser"
import { SowView } from "../../../../sow/SowView"
import { SPLIT_MAX, SPLIT_MIN, money, type SowDocument, type SowPayment } from "@/lib/sow/build"

async function authFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  const token = session?.access_token || sessionStorage.getItem("signal_handoff_token")
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}`, ...(opts.body ? { "Content-Type": "application/json" } : {}) },
  })
}

type Sow = {
  status: string
  saved: boolean
  opening: string | null
  price_override_cents: number | null
  package_total_cents: number
  total_cents: number
  payment: SowPayment
  document: SowDocument
  warnings: string[]
}
type Draft = { opening: string; price: string; mode: "full" | "split"; payments: { amount: string; days: string }[] }

const dollars = (cents: number) => String(cents / 100)
const toCents = (s: string): number | null => {
  const t = s.trim().replace(/[$,]/g, "")
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN
}
const toDraft = (s: Sow): Draft => ({
  opening: s.opening ?? "",
  price: s.price_override_cents === null ? "" : dollars(s.price_override_cents),
  mode: s.payment.mode,
  payments: s.payment.mode === "split"
    ? s.payment.payments.map((p) => ({ amount: dollars(p.amount_cents), days: String(p.days) }))
    : [],
})

const field: React.CSSProperties = {
  background: T.NAV_DEFAULT_BG, color: T.TEXT, border: `1px solid ${T.BORDER_SOFT}`, borderRadius: 8,
  padding: "6px 8px", fontSize: TYPE.secondary, fontFamily: "inherit",
}
const small: React.CSSProperties = {
  background: "transparent", color: T.TEXT, border: `1px solid ${T.BORDER_SOFT}`, borderRadius: 8,
  padding: "5px 10px", fontSize: TYPE.micro, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
}
const label: React.CSSProperties = { fontSize: TYPE.micro, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", color: T.DIM }

export function SowPanel({ coachClientId, engagementId, refreshKey = 0 }: { coachClientId: string; engagementId: string; refreshKey?: number }) {
  const url = `/api/coach/coach-clients/${coachClientId}/engagements/${engagementId}/sow`
  const [sow, setSow] = useState<Sow | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedOk, setSavedOk] = useState(false)
  const [previewing, setPreviewing] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await authFetch(url)
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) { setError(j?.error || `Couldn't load the SOW (${res.status})`); return }
      setSow(j.sow)
      setDraft(toDraft(j.sow))
      setError(null)
    } catch {
      setError("Network error, try again")
    }
  }, [url])

  useEffect(() => { void load() }, [load, refreshKey])

  const total = useMemo(() => {
    if (!sow || !draft) return 0
    const p = toCents(draft.price)
    return p === null || Number.isNaN(p) ? sow.package_total_cents : p
  }, [sow, draft])
  const allocated = draft?.payments.reduce((s, p) => s + (toCents(p.amount) || 0), 0) ?? 0
  const dirty = !!sow && !!draft && JSON.stringify(draft) !== JSON.stringify(toDraft(sow))

  if (error && !sow) return <p role="alert" style={{ fontSize: TYPE.secondary, color: T.ERROR, margin: 0 }}>{error}</p>
  if (!sow || !draft) return <p style={{ fontSize: TYPE.secondary, color: T.MUTED, margin: 0 }}>Loading the SOW…</p>

  const set = (patch: Partial<Draft>) => { setDraft({ ...draft, ...patch }); setSavedOk(false); setError(null) }
  const setPayment = (i: number, patch: Partial<Draft["payments"][number]>) =>
    set({ payments: draft.payments.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) })
  const chooseSplit = (d: Draft) => {
    const half = Math.floor(total / 2 / 100) * 100
    set({ mode: "split", payments: d.payments.length ? d.payments : [{ amount: dollars(half), days: "0" }, { amount: dollars(total - half), days: "45" }] })
  }

  async function save(): Promise<boolean> {
    const price = toCents(draft!.price)
    if (Number.isNaN(price)) { setError("The price for this client must be a number."); return false }
    const payment = draft!.mode === "full"
      ? { mode: "full" }
      : { mode: "split", payments: draft!.payments.map((p) => ({ amount_cents: toCents(p.amount) ?? 0, days: Number(p.days) })) }
    setSaving(true)
    setError(null)
    try {
      const res = await authFetch(url, { method: "PUT", body: JSON.stringify({ opening: draft!.opening, price_override_cents: price, payment }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) { setError(j?.error || `Save failed (${res.status})`); return false }
      setSow(j.sow)
      setDraft(toDraft(j.sow))
      setSavedOk(true)
      return true
    } catch {
      setError("Network error, try again")
      return false
    } finally {
      setSaving(false)
    }
  }

  return (
    <div data-testid="sow-panel" style={{ marginTop: 12, padding: 12, borderRadius: 10, border: `1px solid ${T.BORDER_SOFT}`, background: T.GLASS }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: TYPE.secondary, fontWeight: 800, color: T.TEXT }}>SOW</span>
        <span style={{ fontSize: TYPE.micro, color: T.MUTED }}>{sow.saved ? "Saved" : "Not saved yet (showing the defaults)"}</span>
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
        <span style={label}>Opening paragraph</span>
        <textarea aria-label="Opening paragraph" value={draft.opening} maxLength={3000} placeholder="Written for this client, at the top of their SOW"
          onChange={(e) => set({ opening: e.target.value })}
          style={{ ...field, minHeight: 80, resize: "vertical", lineHeight: 1.45 }} />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10, maxWidth: 260 }}>
        <span style={label}>SOW price for this client</span>
        <input aria-label="SOW price for this client" value={draft.price} inputMode="decimal"
          placeholder={`${money(sow.package_total_cents)} (package total)`}
          onChange={(e) => set({ price: e.target.value })} style={field} />
      </label>

      <div style={{ marginBottom: 10 }}>
        <div style={label}>Payment</div>
        <div role="radiogroup" aria-label="Payment terms" style={{ display: "flex", gap: 14, marginTop: 6, fontSize: TYPE.secondary, color: T.TEXT }}>
          <label><input type="radio" name={`pay-${engagementId}`} checked={draft.mode === "full"} onChange={() => set({ mode: "full", payments: [] })} /> Full up front</label>
          <label><input type="radio" name={`pay-${engagementId}`} checked={draft.mode === "split"} onChange={() => chooseSplit(draft)} /> Split</label>
        </div>
        {draft.mode === "split" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {draft.payments.map((p, i) => (
              <div key={i} data-testid="sow-payment-row" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: TYPE.secondary, color: T.TEXT, flexWrap: "wrap" }}>
                <span style={{ minWidth: 72 }}>Payment {i + 1}</span>
                <span>$</span>
                <input aria-label={`Payment ${i + 1} amount`} value={p.amount} inputMode="decimal" onChange={(e) => setPayment(i, { amount: e.target.value })} style={{ ...field, width: 100 }} />
                <input aria-label={`Payment ${i + 1} days`} value={p.days} inputMode="numeric" onChange={(e) => setPayment(i, { days: e.target.value })} style={{ ...field, width: 60 }} />
                <span style={{ color: T.MUTED }}>days after Let&apos;s Go</span>
                {draft.payments.length > SPLIT_MIN && (
                  <button type="button" aria-label={`Remove payment ${i + 1}`} style={small} onClick={() => set({ payments: draft.payments.filter((_, idx) => idx !== i) })}>✕</button>
                )}
              </div>
            ))}
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {draft.payments.length < SPLIT_MAX && (
                <button type="button" style={small} onClick={() => set({ payments: [...draft.payments, { amount: "", days: draft.payments.at(-1)?.days ?? "0" }] })}>+ Add payment</button>
              )}
              <span data-testid="sow-left" style={{ fontSize: TYPE.micro, fontWeight: 700, color: allocated === total ? T.SUCCESS : T.ERROR }}>
                {allocated === total ? `Adds up to ${money(total)}`
                  : allocated > total ? `${money(allocated - total)} over the total of ${money(total)}`
                  : `${money(total - allocated)} left to allocate of ${money(total)}`}
              </span>
            </div>
          </div>
        )}
      </div>

      {sow.warnings.length > 0 && (
        <ul data-testid="sow-warnings" style={{ margin: "0 0 10px", paddingLeft: 18, fontSize: TYPE.micro, color: T.MUTED }}>
          {sow.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
      {error && <div role="alert" style={{ fontSize: TYPE.micro, color: T.ERROR, marginBottom: 8 }}>{error}</div>}
      {savedOk && !dirty && <div role="status" style={{ fontSize: TYPE.micro, color: T.SUCCESS, marginBottom: 8 }}>SOW saved.</div>}

      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled={saving || (!dirty && sow.saved)} onClick={() => void save()}
          style={{ ...btnPrimary, padding: "7px 14px", fontSize: TYPE.secondary, opacity: saving || (!dirty && sow.saved) ? 0.5 : 1 }}>
          {saving ? "Saving…" : "Save SOW"}
        </button>
        <button type="button" style={small} disabled={saving}
          onClick={async () => { if (dirty && !(await save())) return; setPreviewing(true) }}>
          {dirty ? "Save and preview" : "Preview"}
        </button>
      </div>

      {previewing && (
        <div onClick={() => setPreviewing(false)} style={{ position: "fixed", inset: 0, background: "rgba(8,32,63,0.45)", zIndex: 1000, overflowY: "auto", padding: "24px 12px" }}>
          <div role="dialog" aria-label="SOW preview" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 780, margin: "0 auto", borderRadius: 16, overflow: "hidden", background: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 12px", background: "#fff" }}>
              <button type="button" onClick={() => setPreviewing(false)} style={{ ...small, color: "#08203F", borderColor: "#D9E4EF" }}>Close preview</button>
            </div>
            <SowView doc={sow.document} preview />
          </div>
        </div>
      )}
    </div>
  )
}
