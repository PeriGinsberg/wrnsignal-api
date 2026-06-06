"use client"

// Documents tab content — the coach's document-category master list (Services →
// Documents). This is the practice-level curation surface; every client's
// Library consumes this list. Backed by the per-row categories API:
//   GET    /api/coach/document-categories        (lists active; seeds the 8
//                                                 defaults on first load)
//   POST   /api/coach/document-categories  {name}
//   PATCH  /api/coach/document-categories/[id]  {name?, sort_order?}
//   DELETE /api/coach/document-categories/[id]  (soft — active=false)
//
// Like DeliverablesTab, every operation is immediate + optimistic (rename, add,
// delete, reorder) with a single inline error banner; on ANY write failure we
// resync from the server so local state can't diverge. Reorder uses the
// MyPipelineSection arrow UX (▲▼ disabled at the ends), persisting order by
// swapping the two adjacent rows' sort_order values (two PATCHes) — robust
// against ties, no deferred "Save order" step.
//
// getToken/authFetch are inlined per the coach-route client convention (same
// pair as DeliverablesTab / MyPipelineSection).

import { useCallback, useEffect, useState } from "react"
import { T, input, btnSecondary } from "../../../../../lib/dashboard-theme"
import { getSupabaseBrowser } from "../../../../../lib/supabase-browser"

const NAME_MAX = 60

type Category = {
  id: string
  name: string
  sort_order: number
  is_custom: boolean
  active: boolean
}

// ── Auth (same inline pattern as DeliverablesTab / MyPipelineSection) ──
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

const BASE = "/api/coach/document-categories"

export function DocumentsTab() {
  const [items, setItems] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // One banner for all write failures (create/rename/delete/reorder).
  const [actionError, setActionError] = useState<string | null>(null)

  const [newName, setNewName] = useState("")
  const [creating, setCreating] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")
  const [savingEditId, setSavingEditId] = useState<string | null>(null)

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [reordering, setReordering] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await authFetch(BASE)
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        setLoadError(j?.error || `Couldn't load categories (${res.status})`)
        return
      }
      setItems(j.categories || [])
    } catch {
      setLoadError("Network error — try again")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Silent re-fetch to resync after a write error (no full loading flip).
  const resync = useCallback(async () => {
    try {
      const res = await authFetch(BASE)
      const j = await res.json().catch(() => ({}))
      if (res.ok && j?.ok) setItems(j.categories || [])
    } catch {
      /* leave the action banner as the surfaced error */
    }
  }, [])

  async function handleCreate() {
    const name = newName.trim()
    if (!name || creating) return
    if (name.length > NAME_MAX) { setActionError(`Name too long (max ${NAME_MAX})`); return }
    setCreating(true)
    setActionError(null)
    try {
      const res = await authFetch(BASE, { method: "POST", body: JSON.stringify({ name }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        setActionError(j?.error || `Create failed (${res.status})`)
        await resync()
        return
      }
      setItems((prev) => [...prev, j.category as Category]) // server assigns sort_order = max+1
      setNewName("")
    } catch {
      setActionError("Network error — try again")
      await resync()
    } finally {
      setCreating(false)
    }
  }

  function startEdit(c: Category) {
    setActionError(null)
    setConfirmDeleteId(null)
    setEditingId(c.id)
    setEditValue(c.name)
  }
  function cancelEdit() {
    setEditingId(null)
    setEditValue("")
  }

  async function commitEdit(id: string) {
    const name = editValue.trim()
    const current = items.find((c) => c.id === id)
    if (!name || !current || name === current.name) { cancelEdit(); return }
    if (name.length > NAME_MAX) { setActionError(`Name too long (max ${NAME_MAX})`); return }
    setSavingEditId(id)
    setActionError(null)
    // Optimistic rename.
    setItems((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)))
    cancelEdit()
    try {
      const res = await authFetch(`${BASE}/${id}`, { method: "PATCH", body: JSON.stringify({ name }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        setActionError(j?.error || `Rename failed (${res.status})`)
        await resync()
        return
      }
      setItems((prev) => prev.map((c) => (c.id === id ? (j.category as Category) : c)))
    } catch {
      setActionError("Network error — try again")
      await resync()
    } finally {
      setSavingEditId(null)
    }
  }

  // Reorder: swap the two adjacent rows' sort_order values (keeps them distinct
  // → no ties), optimistically re-sort, then PATCH both rows. On any failure,
  // banner + resync snaps back to server truth.
  async function reorder(i: number, dir: -1 | 1) {
    const j = i + dir
    if (reordering || j < 0 || j >= items.length) return
    const a = items[i]
    const b = items[j]
    setActionError(null)
    setReordering(true)
    cancelEdit()
    const next = items
      .map((c) => {
        if (c.id === a.id) return { ...c, sort_order: b.sort_order }
        if (c.id === b.id) return { ...c, sort_order: a.sort_order }
        return c
      })
      .sort((x, y) => x.sort_order - y.sort_order)
    setItems(next) // optimistic
    try {
      const [r1, r2] = await Promise.all([
        authFetch(`${BASE}/${a.id}`, { method: "PATCH", body: JSON.stringify({ sort_order: b.sort_order }) }),
        authFetch(`${BASE}/${b.id}`, { method: "PATCH", body: JSON.stringify({ sort_order: a.sort_order }) }),
      ])
      if (!r1.ok || !r2.ok) {
        setActionError("Couldn't save the new order — reloaded the current order.")
        await resync()
      }
    } catch {
      setActionError("Network error — try again")
      await resync()
    } finally {
      setReordering(false)
    }
  }

  async function confirmDelete(id: string) {
    if (deletingId) return
    setDeletingId(id)
    setActionError(null)
    try {
      const res = await authFetch(`${BASE}/${id}`, { method: "DELETE" })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        setActionError(j?.error || `Delete failed (${res.status})`)
        await resync()
        return
      }
      setItems((prev) => prev.filter((c) => c.id !== id))
    } catch {
      setActionError("Network error — try again")
      await resync()
    } finally {
      setDeletingId(null)
      setConfirmDeleteId(null)
    }
  }

  if (loading) {
    return <p style={{ fontSize: 13, color: T.MUTED, margin: 0 }}>Loading your document categories…</p>
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
        Your master list of document categories — used to organize links in every client’s
        Library. Editing it here applies across all clients.
      </p>

      {actionError && (
        <div style={{ marginBottom: 16 }}><Banner kind="error">{actionError}</Banner></div>
      )}

      {items.length === 0 ? (
        <p style={{ fontSize: 13, color: T.DIM, margin: "0 0 16px" }}>
          No categories yet — add your first one below.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
          {items.map((c, i) => (
            <Row
              key={c.id}
              category={c}
              position={i + 1}
              canUp={i > 0 && !reordering}
              canDown={i < items.length - 1 && !reordering}
              editing={editingId === c.id}
              editValue={editValue}
              saving={savingEditId === c.id}
              confirming={confirmDeleteId === c.id}
              deleting={deletingId === c.id}
              onUp={() => void reorder(i, -1)}
              onDown={() => void reorder(i, 1)}
              onStartEdit={() => startEdit(c)}
              onEditChange={setEditValue}
              onEditCommit={() => void commitEdit(c.id)}
              onEditCancel={cancelEdit}
              onAskDelete={() => { setActionError(null); setEditingId(null); setConfirmDeleteId(c.id) }}
              onConfirmDelete={() => void confirmDelete(c.id)}
              onCancelDelete={() => setConfirmDeleteId(null)}
            />
          ))}
        </div>
      )}

      {/* Add category — always visible; doubles as the empty-state CTA. */}
      <div style={{ paddingTop: 16, borderTop: `1px solid ${T.BORDER_SOFT}` }}>
        <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: T.DIM, marginBottom: 10 }}>
          Add a category
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={newName}
            onChange={(e) => { setNewName(e.target.value); setActionError(null) }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleCreate() } }}
            placeholder="Category name…"
            maxLength={NAME_MAX}
            style={{ ...input, flex: 1 }}
          />
          <button
            onClick={() => void handleCreate()}
            disabled={!newName.trim() || creating}
            style={{ ...btnSecondary, opacity: !newName.trim() || creating ? 0.5 : 1, cursor: !newName.trim() || creating ? "default" : "pointer", whiteSpace: "nowrap" }}
          >
            {creating ? "Adding…" : "+ Add category"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Display / edit row ──
function Row({
  category, position, canUp, canDown, editing, editValue, saving,
  confirming, deleting,
  onUp, onDown, onStartEdit, onEditChange, onEditCommit, onEditCancel,
  onAskDelete, onConfirmDelete, onCancelDelete,
}: {
  category: Category
  position: number
  canUp: boolean
  canDown: boolean
  editing: boolean
  editValue: string
  saving: boolean
  confirming: boolean
  deleting: boolean
  onUp: () => void
  onDown: () => void
  onStartEdit: () => void
  onEditChange: (v: string) => void
  onEditCommit: () => void
  onEditCancel: () => void
  onAskDelete: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
}) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 12px", borderRadius: 12,
        border: `1px solid ${T.BORDER_SOFT}`, background: T.GLASS,
      }}
    >
      {/* Reorder arrows (disabled at ends / while a reorder is in flight) */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, width: 22, flexShrink: 0 }}>
        <ArrowBtn dir="up" disabled={!canUp || editing || confirming} onClick={onUp} />
        <ArrowBtn dir="down" disabled={!canDown || editing || confirming} onClick={onDown} />
      </div>

      <span style={{ fontSize: 11, color: T.DIM, width: 18, textAlign: "right", flexShrink: 0 }}>{position}</span>

      {confirming ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 12, color: T.MUTED, flex: 1, minWidth: 220 }}>
            Remove “{category.name}”? Links in this category across all clients become
            Uncategorized. (This doesn’t delete any links.)
          </span>
          <button onClick={onConfirmDelete} disabled={deleting} style={{ ...smallBtn, color: T.ERROR, borderColor: "rgba(255,120,120,0.4)", opacity: deleting ? 0.6 : 1 }}>
            {deleting ? "Removing…" : "Remove"}
          </button>
          <button onClick={onCancelDelete} disabled={deleting} style={smallBtn}>Cancel</button>
        </div>
      ) : (
        <>
          <div style={{ flex: 1, minWidth: 0 }}>
            {editing ? (
              <input
                autoFocus
                value={editValue}
                onChange={(e) => onEditChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); onEditCommit() }
                  if (e.key === "Escape") { e.preventDefault(); onEditCancel() }
                }}
                onBlur={onEditCommit}
                maxLength={NAME_MAX}
                style={{ ...input, height: 34 }}
              />
            ) : (
              <span style={{ fontSize: 14, color: T.TEXT, fontWeight: 600 }}>{category.name}</span>
            )}
            {!editing && category.is_custom && <Tag color={T.WRN_BLUE}>custom</Tag>}
          </div>

          {!editing && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              {saving && <span style={{ fontSize: 11, color: T.DIM }}>Saving…</span>}
              <IconBtn label="Rename" onClick={onStartEdit}>✎</IconBtn>
              <IconBtn label="Remove category" danger onClick={onAskDelete}>✕</IconBtn>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ArrowBtn({ dir, disabled, onClick }: { dir: "up" | "down"; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "up" ? "Move up" : "Move down"}
      style={{
        background: "transparent",
        border: "none",
        color: disabled ? T.DIM : T.MUTED,
        cursor: disabled ? "default" : "pointer",
        fontSize: 10,
        lineHeight: "10px",
        padding: 2,
      }}
    >
      {dir === "up" ? "▲" : "▼"}
    </button>
  )
}

function IconBtn({ children, label, danger, onClick }: { children: React.ReactNode; label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        background: "transparent",
        border: `1px solid ${T.BORDER_SOFT}`,
        color: danger ? T.ERROR : T.MUTED,
        borderRadius: 8,
        cursor: "pointer",
        fontSize: 12,
        lineHeight: "12px",
        padding: "6px 8px",
      }}
    >
      {children}
    </button>
  )
}

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

function Tag({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span
      style={{
        marginLeft: 8,
        fontSize: 9, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase",
        color, border: `1px solid ${color}`, borderRadius: 6, padding: "1px 5px",
        verticalAlign: "middle",
      }}
    >
      {children}
    </span>
  )
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
