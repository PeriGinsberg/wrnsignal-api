"use client"

// Packages tab content — the coach's bundles of deliverables with live pricing
// (Services → Packages). Structurally mirrors DeliverablesTab: list / create /
// edit / delete / toggle against the per-row CRUD API:
//   GET    /api/coach/packages
//   POST   /api/coach/packages
//   PATCH  /api/coach/packages/[id]
//   DELETE /api/coach/packages/[id]
//   POST   /api/coach/packages/[id]/deliverables                 (link)
//   DELETE /api/coach/packages/[id]/deliverables/[milestone_id]  (unlink)
//
// Per-row immediate REST. Optimistic on success; on ANY write failure we show an
// inline banner AND refetch (resync) so local state can't diverge from server
// truth. The coach's deliverable catalog (GET /api/coach/milestones) is fetched
// alongside the packages for the multi-select + client-side price preview.
//
// Money: DOLLARS at the edge everywhere — never show cents. The server response
// (toApiPackage) is the source of truth for saved price; the form's live preview
// is editing-only and mirrors the server math (subtotal of priced deliverables,
// total = max(0, subtotal − discount)).
//
// getToken/authFetch are inlined per the coach-route client convention (same
// pair as DeliverablesTab); there is no shared helper module.

import { useCallback, useEffect, useState } from "react"
import { T, input, btnPrimary, btnSecondary } from "../../../../../lib/dashboard-theme"
import { getSupabaseBrowser } from "../../../../../lib/supabase-browser"

const NAME_MAX = 120

type Deliverable = {
  id: string
  name: string
  description: string | null
  category: string | null
  sort_order: number
  active: boolean
  time_estimate_days: number | null
  fee: number | null // DOLLARS; null = unpriced
}

type Pricing = {
  subtotal: number
  unpriced_count: number
  effective_discount: number
  total: number
  discount_clamped: boolean
}

type Package = {
  id: string
  name: string
  description: string | null
  active: boolean
  sort_order: number
  discount: number | null // DOLLARS; null = no discount
  deliverables: Deliverable[]
  pricing: Pricing
}

// Parse an optional discount field (dollars). Empty/whitespace → null (no
// discount, NOT 0). Otherwise must be a finite number ≥ 0. Mirrors the API.
function parseOptionalNonNegNumber(raw: string): { value: number | null } | { error: string } {
  const s = raw.trim()
  if (!s) return { value: null }
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return { error: "Must be a number ≥ 0" }
  return { value: n }
}

// Money → display, dollars only. "$150" / "$150.50" / "$0".
function fmtMoney(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`
}
// A single deliverable's fee in the picker. null = unpriced, 0 = "Free".
function fmtFee(fee: number | null): string {
  if (fee === null) return "Unpriced"
  if (fee === 0) return "Free"
  return fmtMoney(fee)
}

// ── Auth (same inline pattern as DeliverablesTab) ──
async function getToken(): Promise<string | null> {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  if (session?.access_token) return session.access_token
  return sessionStorage.getItem("signal_handoff_token")
}
async function authFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const token = await getToken()
  return fetch(url, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      Authorization: `Bearer ${token}`,
      ...(opts.body && typeof opts.body === "string" ? { "Content-Type": "application/json" } : {}),
    },
  })
}

export function PackagesTab() {
  const [items, setItems] = useState<Package[]>([])
  const [catalog, setCatalog] = useState<Deliverable[]>([]) // coach's deliverables, for the picker + preview
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // Create form.
  const [cName, setCName] = useState("")
  const [cDesc, setCDesc] = useState("")
  const [cDiscount, setCDiscount] = useState("")
  const [cSelected, setCSelected] = useState<string[]>([])
  const [creating, setCreating] = useState(false)

  // Inline edit. eOrig holds the deliverable set at edit-start so save can diff.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [eName, setEName] = useState("")
  const [eDesc, setEDesc] = useState("")
  const [eDiscount, setEDiscount] = useState("")
  const [eSelected, setESelected] = useState<string[]>([])
  const [eOrig, setEOrig] = useState<string[]>([])
  const [savingEdit, setSavingEdit] = useState(false)

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [pkgRes, delRes] = await Promise.all([
        authFetch("/api/coach/packages"),
        authFetch("/api/coach/milestones"),
      ])
      const pkgJson = await pkgRes.json().catch(() => ({}))
      const delJson = await delRes.json().catch(() => ({}))
      if (!pkgRes.ok || !pkgJson?.ok) {
        setLoadError(pkgJson?.error || `Couldn't load packages (${pkgRes.status})`)
        return
      }
      setItems(pkgJson.packages || [])
      if (delRes.ok && delJson?.ok) setCatalog(delJson.milestones || [])
    } catch {
      setLoadError("Network error — try again")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Silent re-fetch of the package list after a write error (no loading flip).
  const resync = useCallback(async () => {
    try {
      const res = await authFetch("/api/coach/packages")
      const j = await res.json().catch(() => ({}))
      if (res.ok && j?.ok) setItems(j.packages || [])
    } catch {
      /* leave the action banner as the surfaced error */
    }
  }, [])

  async function handleCreate() {
    const name = cName.trim()
    if (!name || creating) return
    const discountParsed = parseOptionalNonNegNumber(cDiscount)
    if ("error" in discountParsed) { setActionError(`Discount: ${discountParsed.error}`); return }
    setCreating(true)
    setActionError(null)
    try {
      const res = await authFetch("/api/coach/packages", {
        method: "POST",
        body: JSON.stringify({
          name,
          description: cDesc.trim() || undefined,
          discount: discountParsed.value, // dollars; null = no discount
          deliverable_ids: cSelected,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        setActionError(j?.error || `Create failed (${res.status})`)
        await resync()
        return
      }
      setItems((prev) => [...prev, j.package as Package])
      setCName(""); setCDesc(""); setCDiscount(""); setCSelected([])
    } catch {
      setActionError("Network error — try again")
      await resync()
    } finally {
      setCreating(false)
    }
  }

  function startEdit(p: Package) {
    setActionError(null)
    setConfirmDeleteId(null)
    setEditingId(p.id)
    setEName(p.name)
    setEDesc(p.description ?? "")
    setEDiscount(p.discount != null ? String(p.discount) : "") // dollars, not cents
    const ids = p.deliverables.map((d) => d.id)
    setESelected(ids)
    setEOrig(ids)
  }
  function cancelEdit() {
    setEditingId(null)
    setEName(""); setEDesc(""); setEDiscount(""); setESelected([]); setEOrig([])
  }

  async function saveEdit(id: string) {
    const name = eName.trim()
    if (!name) { setActionError("Name cannot be empty"); return }
    const discountParsed = parseOptionalNonNegNumber(eDiscount)
    if ("error" in discountParsed) { setActionError(`Discount: ${discountParsed.error}`); return }
    if (savingEdit) return
    setSavingEdit(true)
    setActionError(null)
    try {
      // 1) Fields.
      const patchRes = await authFetch(`/api/coach/packages/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          description: eDesc.trim() ? eDesc.trim() : null,
          discount: discountParsed.value, // null clears it
        }),
      })
      const patchJson = await patchRes.json().catch(() => ({}))
      if (!patchRes.ok || !patchJson?.ok) {
        setActionError(patchJson?.error || `Save failed (${patchRes.status})`)
        await resync()
        return
      }

      // 2) Re-sync deliverable links via diff (link adds, unlink removes).
      const origSet = new Set(eOrig)
      const selSet = new Set(eSelected)
      const toAdd = eSelected.filter((mid) => !origSet.has(mid))
      const toRemove = eOrig.filter((mid) => !selSet.has(mid))

      if (toAdd.length) {
        const linkRes = await authFetch(`/api/coach/packages/${id}/deliverables`, {
          method: "POST",
          body: JSON.stringify({ milestone_ids: toAdd }),
        })
        const linkJson = await linkRes.json().catch(() => ({}))
        if (!linkRes.ok || !linkJson?.ok) {
          setActionError(linkJson?.error || `Linking failed (${linkRes.status})`)
          await resync()
          return
        }
      }
      for (const mid of toRemove) {
        const unlinkRes = await authFetch(`/api/coach/packages/${id}/deliverables/${mid}`, { method: "DELETE" })
        const unlinkJson = await unlinkRes.json().catch(() => ({}))
        if (!unlinkRes.ok || !unlinkJson?.ok) {
          setActionError(unlinkJson?.error || `Unlinking failed (${unlinkRes.status})`)
          await resync()
          return
        }
      }

      // 3) Trust the server: re-read the canonical package (price + links).
      const freshRes = await authFetch(`/api/coach/packages/${id}`)
      const freshJson = await freshRes.json().catch(() => ({}))
      if (freshRes.ok && freshJson?.ok) {
        setItems((prev) => prev.map((p) => (p.id === id ? (freshJson.package as Package) : p)))
      } else {
        await resync()
      }
      cancelEdit()
    } catch {
      setActionError("Network error — try again")
      await resync()
    } finally {
      setSavingEdit(false)
    }
  }

  async function toggleActive(p: Package) {
    if (togglingId) return
    setTogglingId(p.id)
    setActionError(null)
    const next = !p.active
    setItems((prev) => prev.map((x) => (x.id === p.id ? { ...x, active: next } : x))) // optimistic
    try {
      const res = await authFetch(`/api/coach/packages/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: next }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        setActionError(j?.error || `Couldn't update (${res.status})`)
        await resync() // snaps the toggle back to server truth
        return
      }
      setItems((prev) => prev.map((x) => (x.id === p.id ? (j.package as Package) : x)))
    } catch {
      setActionError("Network error — try again")
      await resync()
    } finally {
      setTogglingId(null)
    }
  }

  async function confirmDelete(id: string) {
    if (deletingId) return
    setDeletingId(id)
    setActionError(null)
    try {
      const res = await authFetch(`/api/coach/packages/${id}`, { method: "DELETE" })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        setActionError(j?.error || `Delete failed (${res.status})`)
        await resync()
        return
      }
      setItems((prev) => prev.filter((p) => p.id !== id))
    } catch {
      setActionError("Network error — try again")
      await resync()
    } finally {
      setDeletingId(null)
      setConfirmDeleteId(null)
    }
  }

  if (loading) {
    return <p style={{ fontSize: 13, color: T.MUTED, margin: 0 }}>Loading your packages…</p>
  }
  if (loadError) {
    return (
      <div>
        <Banner kind="error">{loadError}</Banner>
        <button style={{ ...btnSecondary, marginTop: 12 }} onClick={() => void load()}>Retry</button>
      </div>
    )
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: T.MUTED, margin: "0 0 16px" }}>
        Bundle your deliverables into packages with a single price. Pick the deliverables,
        set an optional discount, and the price is computed for you.
      </p>

      {actionError && (
        <div style={{ marginBottom: 16 }}><Banner kind="error">{actionError}</Banner></div>
      )}

      {items.length === 0 ? (
        <p style={{ fontSize: 13, color: T.DIM, margin: "0 0 16px" }}>
          No packages yet — create your first one below.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
          {items.map((p) =>
            editingId === p.id ? (
              <div
                key={p.id}
                style={{ padding: 12, borderRadius: 12, border: `1px solid ${T.BORDER_SOFT}`, background: T.GLASS }}
              >
                <PackageForm
                  name={eName} description={eDesc} discount={eDiscount} selected={eSelected}
                  catalog={catalog}
                  onName={setEName} onDescription={setEDesc} onDiscount={setEDiscount}
                  onToggleDeliverable={(mid) =>
                    setESelected((prev) => (prev.includes(mid) ? prev.filter((x) => x !== mid) : [...prev, mid]))
                  }
                  onSubmit={() => void saveEdit(p.id)} submitLabel="Save"
                  busy={savingEdit} onCancel={cancelEdit}
                />
              </div>
            ) : (
              <Row
                key={p.id}
                p={p}
                toggling={togglingId === p.id}
                deleting={deletingId === p.id}
                confirming={confirmDeleteId === p.id}
                onToggle={() => void toggleActive(p)}
                onEdit={() => startEdit(p)}
                onAskDelete={() => { setActionError(null); setConfirmDeleteId(p.id) }}
                onConfirmDelete={() => void confirmDelete(p.id)}
                onCancelDelete={() => setConfirmDeleteId(null)}
              />
            )
          )}
        </div>
      )}

      {/* Create form — always visible; doubles as the empty-state CTA. */}
      <div style={{ paddingTop: 16, borderTop: `1px solid ${T.BORDER_SOFT}` }}>
        <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: T.DIM, marginBottom: 10 }}>
          Add a package
        </div>
        <PackageForm
          name={cName} description={cDesc} discount={cDiscount} selected={cSelected}
          catalog={catalog}
          onName={setCName} onDescription={setCDesc} onDiscount={setCDiscount}
          onToggleDeliverable={(mid) =>
            setCSelected((prev) => (prev.includes(mid) ? prev.filter((x) => x !== mid) : [...prev, mid]))
          }
          onSubmit={() => void handleCreate()} submitLabel="+ Add package"
          busy={creating}
        />
      </div>
    </div>
  )
}

// ── Display row ──
function Row({
  p, toggling, deleting, confirming,
  onToggle, onEdit, onAskDelete, onConfirmDelete, onCancelDelete,
}: {
  p: Package
  toggling: boolean
  deleting: boolean
  confirming: boolean
  onToggle: () => void
  onEdit: () => void
  onAskDelete: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
}) {
  const count = p.deliverables.length
  const meta: string[] = [
    `${count} deliverable${count === 1 ? "" : "s"}`,
    fmtMoney(p.pricing.total),
  ]
  if (p.discount != null && p.discount > 0) meta.push(`${fmtMoney(p.discount)} off`)
  if (p.pricing.unpriced_count > 0) meta.push(`${p.pricing.unpriced_count} unpriced`)

  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 12px", borderRadius: 12,
        border: `1px solid ${T.BORDER_SOFT}`, background: T.GLASS,
        opacity: p.active ? 1 : 0.55,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 14, color: T.TEXT, fontWeight: 600 }}>{p.name}</span>
        {p.description && (
          <div style={{ fontSize: 12, color: T.MUTED, marginTop: 3 }}>{p.description}</div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 4, fontSize: 12, color: T.MUTED }}>
          {meta.map((m, i) => (
            <span key={i} style={i === 1 ? { color: T.TEXT, fontWeight: 700 } : undefined}>{m}</span>
          ))}
        </div>
      </div>

      {confirming ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: T.MUTED }}>Delete this package?</span>
          <button onClick={onConfirmDelete} disabled={deleting} style={{ ...smallBtn, color: T.ERROR, borderColor: "rgba(255,120,120,0.4)", opacity: deleting ? 0.6 : 1 }}>
            {deleting ? "Deleting…" : "Delete"}
          </button>
          <button onClick={onCancelDelete} disabled={deleting} style={smallBtn}>Cancel</button>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={onToggle}
            disabled={toggling}
            style={{
              background: p.active ? "rgba(74,222,128,0.12)" : T.NAV_DEFAULT_BG,
              border: `1px solid ${p.active ? "rgba(74,222,128,0.40)" : T.BORDER_SOFT}`,
              color: p.active ? T.SUCCESS : T.MUTED,
              borderRadius: 999, padding: "5px 12px", fontSize: 11, fontWeight: 800,
              cursor: toggling ? "default" : "pointer", opacity: toggling ? 0.6 : 1,
              minWidth: 64, whiteSpace: "nowrap",
            }}
          >
            {p.active ? "Active" : "Off"}
          </button>
          <button onClick={onEdit} style={smallBtn}>Edit</button>
          <button onClick={onAskDelete} style={{ ...smallBtn, color: T.ERROR }}>Delete</button>
        </div>
      )}
    </div>
  )
}

// ── Shared create/edit form (name/desc + deliverable picker + discount + live
//    price preview; Enter on a text field submits when valid) ──
function PackageForm({
  name, description, discount, selected, catalog,
  onName, onDescription, onDiscount, onToggleDeliverable,
  onSubmit, submitLabel, busy, onCancel,
}: {
  name: string
  description: string
  discount: string
  selected: string[]
  catalog: Deliverable[]
  onName: (v: string) => void
  onDescription: (v: string) => void
  onDiscount: (v: string) => void
  onToggleDeliverable: (id: string) => void
  onSubmit: () => void
  submitLabel: string
  busy: boolean
  onCancel?: () => void
}) {
  const discountCheck = parseOptionalNonNegNumber(discount)
  const discountErr = "error" in discountCheck ? discountCheck.error : null
  const canSubmit = !!name.trim() && !busy && !discountErr
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); if (canSubmit) onSubmit() }
  }

  // ── Live price preview (editing-only; the server is the source of truth) ──
  const selSet = new Set(selected)
  const chosen = catalog.filter((d) => selSet.has(d.id))
  const subtotal = chosen.reduce((s, d) => s + (d.fee ?? 0), 0) // skip unpriced (null)
  const unpricedCount = chosen.filter((d) => d.fee === null).length
  const discountNum = !("error" in discountCheck) && discountCheck.value !== null ? discountCheck.value : 0
  const total = Math.max(0, subtotal - discountNum)
  const discountCapped = discountNum > subtotal

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input
        style={input}
        placeholder="Name (required)"
        value={name}
        maxLength={NAME_MAX}
        onChange={(e) => onName(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus={!!onCancel}
      />
      <input
        style={input}
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => onDescription(e.target.value)}
        onKeyDown={onKeyDown}
      />

      {/* Deliverable multi-select */}
      <div>
        <label style={fieldLabel}>Deliverables in this package</label>
        {catalog.length === 0 ? (
          <div style={{ fontSize: 12, color: T.DIM, marginTop: 6 }}>
            No deliverables yet — add some in the Deliverables tab first.
          </div>
        ) : (
          <div style={{ marginTop: 6, maxHeight: 184, overflowY: "auto", border: `1px solid ${T.BORDER_SOFT}`, borderRadius: 10 }}>
            {catalog.map((d, i) => {
              const checked = selSet.has(d.id)
              return (
                <label
                  key={d.id}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
                    cursor: "pointer", fontSize: 13, color: T.TEXT,
                    borderTop: i === 0 ? "none" : `1px solid ${T.BORDER_SOFT}`,
                    background: checked ? "rgba(81,173,229,0.08)" : "transparent",
                  }}
                >
                  <input type="checkbox" checked={checked} onChange={() => onToggleDeliverable(d.id)} />
                  <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.name}</span>
                  <span style={{ fontSize: 12, color: d.fee === null ? T.DIM : T.MUTED, whiteSpace: "nowrap" }}>{fmtFee(d.fee)}</span>
                </label>
              )
            })}
          </div>
        )}
      </div>

      {/* Discount (dollars) */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={fieldLabel}>Discount (optional)</label>
        <div style={{ position: "relative", maxWidth: 200 }}>
          <span style={{ position: "absolute", left: 12, top: 0, height: 44, display: "flex", alignItems: "center", fontSize: 13, color: T.MUTED, pointerEvents: "none" }}>$</span>
          <input
            style={{ ...input, paddingLeft: 24 }}
            type="number" min="0" step="any" inputMode="decimal"
            placeholder="0"
            value={discount}
            onChange={(e) => onDiscount(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        {discountErr && <span style={fieldError}>{discountErr}</span>}
      </div>

      {/* Live price preview */}
      <div style={{ borderRadius: 10, border: `1px solid ${T.BORDER_SOFT}`, background: T.GLASS, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
        <PriceRow label={`Subtotal (${chosen.length} selected)`} value={fmtMoney(subtotal)} muted />
        {discountNum > 0 && (
          <PriceRow label="Discount" value={`−${fmtMoney(Math.min(discountNum, subtotal))}`} muted />
        )}
        <PriceRow label="Total" value={fmtMoney(total)} />
        {unpricedCount > 0 && (
          <div style={{ fontSize: 11, color: T.DIM, marginTop: 2 }}>
            {unpricedCount} deliverable{unpricedCount === 1 ? "" : "s"} not yet priced — not included in the total.
          </div>
        )}
        {discountCapped && (
          <div style={{ fontSize: 11, color: T.DIM, marginTop: 2 }}>
            Discount exceeds the subtotal — total capped at $0.
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={onSubmit}
          disabled={!canSubmit}
          style={{ ...btnPrimary, opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? "pointer" : "default" }}
        >
          {busy ? "Saving…" : submitLabel}
        </button>
        {onCancel && <button onClick={onCancel} disabled={busy} style={btnSecondary}>Cancel</button>}
      </div>
    </div>
  )
}

function PriceRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: muted ? 12 : 14 }}>
      <span style={{ color: muted ? T.MUTED : T.TEXT, fontWeight: muted ? 400 : 700 }}>{label}</span>
      <span style={{ color: muted ? T.MUTED : T.TEXT, fontWeight: muted ? 600 : 900 }}>{value}</span>
    </div>
  )
}

const fieldLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 800, letterSpacing: 0.5,
  textTransform: "uppercase", color: T.DIM,
}
const fieldError: React.CSSProperties = { fontSize: 11, color: T.ERROR }

const smallBtn: React.CSSProperties = {
  background: "transparent",
  border: `1px solid ${T.BORDER_SOFT}`,
  color: T.MUTED,
  borderRadius: 8,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
  padding: "6px 10px",
}

function Banner({ kind, children }: { kind: "error" | "success" | "info"; children: React.ReactNode }) {
  const palette =
    kind === "error"
      ? { color: T.ERROR, bg: T.ERROR_BG, border: "rgba(255,120,120,0.30)" }
      : kind === "success"
      ? { color: T.SUCCESS, bg: T.SUCCESS_BG, border: "rgba(74,222,128,0.30)" }
      : { color: T.WRN_BLUE, bg: "rgba(81,173,229,0.10)", border: "rgba(81,173,229,0.30)" }
  return (
    <div style={{ fontSize: 12, color: palette.color, background: palette.bg, border: `1px solid ${palette.border}`, borderRadius: 10, padding: "10px 12px" }}>
      {children}
    </div>
  )
}
