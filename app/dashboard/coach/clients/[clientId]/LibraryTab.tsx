"use client"

// Library — a client's per-client document links (pointers to external files,
// e.g. Google Drive URLs), grouped by the coach's document categories. Keyed by
// coach_clients.id. APIs:
//   GET    /api/coach/document-categories                         (picker + group order)
//   GET    /api/coach/coach-clients/[ccId]/documents              (this client's active links)
//   POST   /api/coach/coach-clients/[ccId]/documents   { title, url, category_id? }
//   PATCH  /api/coach/coach-clients/[ccId]/documents/[doc_id] { title?, url?, category_id?, sort_order? }
//   DELETE /api/coach/coach-clients/[ccId]/documents/[doc_id]     (soft delete)
//
// Links render GROUPED by category (groups ordered by category sort_order), with
// an "Uncategorized" group last — for null-category links AND any link whose
// category is inactive/missing. The server is the source of truth (it normalizes
// URLs); optimistic-on-success, banner + resync on failure. No activity-attach
// UI in this slice. getToken/authFetch inlined per the coach-route convention
// (same pair as EngagementsTab).

import { useCallback, useEffect, useMemo, useState } from "react"
import { T, input, btnPrimary, btnSecondary } from "../../../../../lib/dashboard-theme"
import { getSupabaseBrowser } from "../../../../../lib/supabase-browser"
import { NoteVisibilityIcon } from "../../NoteVisibilityIcon"

const UNCATEGORIZED_KEY = "__uncategorized__"

// Visibility palette — mirrored from NoteVisibilityIcon (teal = shared, goldenrod
// = coach-private) so the row label reads at the same glance as the icon. The
// icon hardcodes these and doesn't export them; keep these two in sync with it.
const VIS_TEAL = "#2CA58D"
const VIS_GOLD = "#E1A92E"

type Category = { id: string; name: string; sort_order: number; is_custom: boolean; active: boolean }
type DocLink = {
  id: string
  category_id: string | null
  activity_id: string | null
  title: string
  url: string
  sort_order: number
  visible_to_client: boolean
}

// Host label under the title (url is server-normalized, so it has a protocol).
function fmtHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

// ── Auth (same inline pattern as EngagementsTab) ──
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

function sortDocs(docs: DocLink[]): DocLink[] {
  return [...docs].sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title))
}

export function LibraryTab({
  coachClientId,
  clientName,
}: {
  coachClientId: string | null
  clientName: string
}) {
  const [cats, setCats] = useState<Category[]>([])
  const [docs, setDocs] = useState<DocLink[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // Add form.
  const [adding, setAdding] = useState(false)
  const [aTitle, setATitle] = useState("")
  const [aUrl, setAUrl] = useState("")
  const [aCategoryId, setACategoryId] = useState<string>("") // "" = Uncategorized
  const [aVisible, setAVisible] = useState(false) // DEFAULT private (matches column default)
  const [creating, setCreating] = useState(false)

  // Per-row visibility toggle in flight (doc id).
  const [togglingVisibleId, setTogglingVisibleId] = useState<string | null>(null)

  // Inline edit.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [eTitle, setETitle] = useState("")
  const [eUrl, setEUrl] = useState("")
  const [eCategoryId, setECategoryId] = useState<string>("")
  const [savingEditId, setSavingEditId] = useState<string | null>(null)

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const base = coachClientId ? `/api/coach/coach-clients/${coachClientId}/documents` : null

  const load = useCallback(async () => {
    if (!base) { setLoading(false); setDocs([]); setCats([]); return } // no relationship → benign empty
    setLoading(true)
    setLoadError(null)
    try {
      const [catRes, docRes] = await Promise.all([
        authFetch("/api/coach/document-categories"),
        authFetch(base),
      ])
      const catJson = await catRes.json().catch(() => ({}))
      const docJson = await docRes.json().catch(() => ({}))
      if (!catRes.ok || !catJson?.ok) {
        setLoadError(catJson?.error || `Couldn't load categories (${catRes.status})`)
        return
      }
      if (!docRes.ok || !docJson?.ok) {
        setLoadError(docJson?.error || `Couldn't load documents (${docRes.status})`)
        return
      }
      setCats(catJson.categories || [])
      setDocs(docJson.documents || [])
    } catch {
      setLoadError("Network error — try again")
    } finally {
      setLoading(false)
    }
  }, [base])

  useEffect(() => { void load() }, [load])

  // Silent re-fetch of the documents after a write error (categories rarely
  // change here; the load() retry covers them).
  const resync = useCallback(async () => {
    if (!base) return
    try {
      const res = await authFetch(base)
      const j = await res.json().catch(() => ({}))
      if (res.ok && j?.ok) setDocs(j.documents || [])
    } catch {
      /* leave the action banner as the surfaced error */
    }
  }, [base])

  // Group docs by category, groups ordered by category sort_order, Uncategorized
  // last. A doc whose category_id is null OR not an active category falls into
  // Uncategorized.
  const groups = useMemo(() => {
    const catById = new Map(cats.map((c) => [c.id, c]))
    const ordered = [...cats].sort((a, b) => a.sort_order - b.sort_order)
    const byCat = new Map<string, DocLink[]>()
    const uncategorized: DocLink[] = []
    for (const d of docs) {
      if (d.category_id && catById.has(d.category_id)) {
        const list = byCat.get(d.category_id) ?? []
        list.push(d)
        byCat.set(d.category_id, list)
      } else {
        uncategorized.push(d)
      }
    }
    const result: { key: string; name: string; docs: DocLink[] }[] = []
    for (const c of ordered) {
      const list = byCat.get(c.id)
      if (list && list.length) result.push({ key: c.id, name: c.name, docs: sortDocs(list) })
    }
    if (uncategorized.length) result.push({ key: UNCATEGORIZED_KEY, name: "Uncategorized", docs: sortDocs(uncategorized) })
    return result
  }, [cats, docs])

  function openAdd() {
    setActionError(null)
    setEditingId(null)
    setATitle(""); setAUrl(""); setACategoryId(""); setAVisible(false)
    setAdding(true)
  }
  function cancelAdd() {
    setAdding(false)
    setATitle(""); setAUrl(""); setACategoryId(""); setAVisible(false)
  }

  async function handleCreate() {
    if (!base || creating) return
    const title = aTitle.trim()
    const url = aUrl.trim()
    if (!title || !url) return
    setCreating(true)
    setActionError(null)
    try {
      const res = await authFetch(base, {
        method: "POST",
        body: JSON.stringify({ title, url, category_id: aCategoryId || undefined, visible_to_client: aVisible }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        setActionError(j?.error || `Couldn't add link (${res.status})`)
        await resync()
        return
      }
      setDocs((prev) => [...prev, j.document as DocLink]) // server normalized the url
      cancelAdd()
    } catch {
      setActionError("Network error — try again")
      await resync()
    } finally {
      setCreating(false)
    }
  }

  function startEdit(d: DocLink) {
    setActionError(null)
    setAdding(false)
    setConfirmDeleteId(null)
    setEditingId(d.id)
    setETitle(d.title)
    setEUrl(d.url)
    // If the doc's category is inactive/missing, the select falls back to ""
    // (Uncategorized) — saving keeps it Uncategorized unless the coach picks one.
    setECategoryId(d.category_id && cats.some((c) => c.id === d.category_id) ? d.category_id : "")
  }
  function cancelEdit() {
    setEditingId(null)
    setETitle(""); setEUrl(""); setECategoryId("")
  }

  async function saveEdit(id: string) {
    if (!base || savingEditId) return
    const title = eTitle.trim()
    const url = eUrl.trim()
    if (!title || !url) { setActionError("Title and URL are required"); return }
    setSavingEditId(id)
    setActionError(null)
    try {
      const res = await authFetch(`${base}/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ title, url, category_id: eCategoryId || null }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        setActionError(j?.error || `Couldn't save link (${res.status})`)
        await resync()
        return
      }
      setDocs((prev) => prev.map((d) => (d.id === id ? (j.document as DocLink) : d)))
      cancelEdit()
    } catch {
      setActionError("Network error — try again")
      await resync()
    } finally {
      setSavingEditId(null)
    }
  }

  async function confirmDelete(id: string) {
    if (!base || deletingId) return
    setDeletingId(id)
    setActionError(null)
    try {
      const res = await authFetch(`${base}/${id}`, { method: "DELETE" })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        setActionError(j?.error || `Couldn't remove link (${res.status})`)
        await resync()
        return
      }
      setDocs((prev) => prev.filter((d) => d.id !== id))
    } catch {
      setActionError("Network error — try again")
      await resync()
    } finally {
      setDeletingId(null)
      setConfirmDeleteId(null)
    }
  }

  // Toggle a doc's client visibility (eye ↔ lock). Optimistic; PATCH; banner +
  // resync (snap back to server truth) on failure.
  async function toggleVisible(d: DocLink) {
    if (!base || togglingVisibleId) return
    const next = !d.visible_to_client
    setTogglingVisibleId(d.id)
    setActionError(null)
    setDocs((prev) => prev.map((x) => (x.id === d.id ? { ...x, visible_to_client: next } : x)))
    try {
      const res = await authFetch(`${base}/${d.id}`, {
        method: "PATCH",
        body: JSON.stringify({ visible_to_client: next }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        setActionError(j?.error || `Couldn't update visibility (${res.status})`)
        await resync()
        return
      }
      setDocs((prev) => prev.map((x) => (x.id === d.id ? (j.document as DocLink) : x)))
    } catch {
      setActionError("Network error — try again")
      await resync()
    } finally {
      setTogglingVisibleId(null)
    }
  }

  // Guard: no relationship resolved → benign empty, not an error.
  if (!coachClientId) {
    return <p style={{ fontSize: 13, color: T.DIM, margin: 0 }}>No library for this client yet.</p>
  }
  if (loading) {
    return <p style={{ fontSize: 13, color: T.MUTED, margin: 0 }}>Loading library…</p>
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
        Links to {clientName}’s documents — Drive files, resumes, guides. These are pointers
        you paste in, organized by your document categories.
      </p>

      {actionError && <div style={{ marginBottom: 16 }}><Banner kind="error">{actionError}</Banner></div>}

      {docs.length === 0 ? (
        <p style={{ fontSize: 13, color: T.DIM, margin: "0 0 16px" }}>
          No documents yet — add links to this client’s Drive files, resumes, guides…
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18, marginBottom: 20 }}>
          {groups.map((g) => (
            <div key={g.key}>
              <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: T.DIM, marginBottom: 8 }}>
                {g.name}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {g.docs.map((d) =>
                  editingId === d.id ? (
                    <div
                      key={d.id}
                      style={{ padding: 12, borderRadius: 12, border: `1px solid ${T.BORDER_SOFT}`, background: T.GLASS }}
                    >
                      <LinkForm
                        title={eTitle} url={eUrl} categoryId={eCategoryId}
                        categories={cats}
                        onTitle={setETitle} onUrl={setEUrl} onCategory={setECategoryId}
                        onSubmit={() => void saveEdit(d.id)} submitLabel="Save"
                        busy={savingEditId === d.id} onCancel={cancelEdit}
                      />
                    </div>
                  ) : (
                    <LinkRow
                      key={d.id}
                      doc={d}
                      confirming={confirmDeleteId === d.id}
                      deleting={deletingId === d.id}
                      toggling={togglingVisibleId === d.id}
                      onToggleVisible={() => void toggleVisible(d)}
                      onEdit={() => startEdit(d)}
                      onAskDelete={() => { setActionError(null); setConfirmDeleteId(d.id) }}
                      onConfirmDelete={() => void confirmDelete(d.id)}
                      onCancelDelete={() => setConfirmDeleteId(null)}
                    />
                  ),
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add control */}
      <div style={{ paddingTop: 16, borderTop: `1px solid ${T.BORDER_SOFT}` }}>
        {!adding ? (
          <button style={btnPrimary} onClick={openAdd}>+ Add a link</button>
        ) : (
          <div style={{ borderRadius: 12, border: `1px solid ${T.BORDER_SOFT}`, background: T.GLASS, padding: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: T.DIM, marginBottom: 10 }}>
              Add a link
            </div>
            <LinkForm
              title={aTitle} url={aUrl} categoryId={aCategoryId}
              categories={cats}
              visible={aVisible} onVisible={setAVisible}
              onTitle={setATitle} onUrl={setAUrl} onCategory={setACategoryId}
              onSubmit={() => void handleCreate()} submitLabel="+ Add link"
              busy={creating} onCancel={cancelAdd}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ── One link row: title (opens in new tab) + host, visibility toggle + edit + delete ──
function LinkRow({
  doc, confirming, deleting, toggling, onToggleVisible, onEdit, onAskDelete, onConfirmDelete, onCancelDelete,
}: {
  doc: DocLink
  confirming: boolean
  deleting: boolean
  toggling: boolean
  onToggleVisible: () => void
  onEdit: () => void
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
      <div style={{ flex: 1, minWidth: 0 }}>
        <a
          href={doc.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 14, color: T.WRN_BLUE, fontWeight: 600, textDecoration: "none", wordBreak: "break-word" }}
        >
          {doc.title}
        </a>
        <div style={{ fontSize: 12, color: T.DIM, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {fmtHost(doc.url)}
        </div>
      </div>

      {confirming ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: T.MUTED }}>Remove this link?</span>
          <button onClick={onConfirmDelete} disabled={deleting} style={{ ...smallBtn, color: T.ERROR, borderColor: "rgba(255,120,120,0.4)", opacity: deleting ? 0.6 : 1 }}>
            {deleting ? "Removing…" : "Remove"}
          </button>
          <button onClick={onCancelDelete} disabled={deleting} style={smallBtn}>Cancel</button>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <VisibilityToggle visible={doc.visible_to_client} busy={toggling} onClick={onToggleVisible} />
          <IconBtn label="Edit link" onClick={onEdit}>✎</IconBtn>
          <IconBtn label="Remove link" danger onClick={onAskDelete}>✕</IconBtn>
        </div>
      )}
    </div>
  )
}

// ── Visibility toggle: eye (shared) / lock (private), glanceable + labeled ──
// Reuses NoteVisibilityIcon for the glyph; click flips visible_to_client.
function VisibilityToggle({ visible, busy, onClick }: { visible: boolean; busy: boolean; onClick: () => void }) {
  const color = visible ? VIS_TEAL : VIS_GOLD
  const full = visible ? "Visible to client" : "Coach-private"
  const action = visible ? "click to make private" : "click to share with client"
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={`${full} — ${action}`}
      title={`${full} — ${action}`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        background: "transparent", border: `1px solid ${T.BORDER_SOFT}`, borderRadius: 8,
        color, fontSize: 11, fontWeight: 800, whiteSpace: "nowrap",
        cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1, padding: "5px 8px",
      }}
    >
      <NoteVisibilityIcon visible={visible} />
      {visible ? "Shared" : "Private"}
    </button>
  )
}

// ── Shared add/edit form (title + url + category picker; optional visibility) ──
// visible/onVisible are only passed by the ADD form (default OFF — private). Edit
// keeps visibility on the per-row eye/lock toggle, so onVisible is omitted there.
function LinkForm({
  title, url, categoryId, categories, visible, onVisible,
  onTitle, onUrl, onCategory, onSubmit, submitLabel, busy, onCancel,
}: {
  title: string
  url: string
  categoryId: string
  categories: Category[]
  visible?: boolean
  onVisible?: (v: boolean) => void
  onTitle: (v: string) => void
  onUrl: (v: string) => void
  onCategory: (v: string) => void
  onSubmit: () => void
  submitLabel: string
  busy: boolean
  onCancel: () => void
}) {
  const valid = !!title.trim() && !!url.trim()
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); if (valid && !busy) onSubmit() }
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input
        style={input}
        placeholder="Title (required)"
        value={title}
        onChange={(e) => onTitle(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
      />
      <input
        style={input}
        placeholder="URL (required) — e.g. https://drive.google.com/…"
        value={url}
        onChange={(e) => onUrl(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <select
        style={{ ...input, cursor: "pointer" }}
        value={categoryId}
        onChange={(e) => onCategory(e.target.value)}
      >
        <option value="">Uncategorized</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      {onVisible && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: T.MUTED, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={!!visible}
            onChange={(e) => onVisible(e.target.checked)}
            style={{ accentColor: T.WRN_ORANGE }}
          />
          Visible to client (off = coach-private)
        </label>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button
          onClick={onSubmit}
          disabled={busy || !valid}
          style={{ ...btnPrimary, opacity: busy || !valid ? 0.5 : 1, cursor: busy || !valid ? "default" : "pointer" }}
        >
          {busy ? "Saving…" : submitLabel}
        </button>
        <button onClick={onCancel} disabled={busy} style={btnSecondary}>Cancel</button>
      </div>
    </div>
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
