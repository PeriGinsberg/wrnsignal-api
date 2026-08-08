"use client"

// Coach-side editing of an ATTACHED engagement: activity CRUD, the sign-off
// flag, the Proof Project toggle and the two prose fields.
//
// EDITING IS A MODE, NOT AN ALWAYS-ON STATE. The read view of an engagement is
// the one a coach looks at during a call, and littering it with delete buttons
// makes an accidental destructive click a matter of time. Everything here is
// behind a per-deliverable "Edit tasks" toggle.
//
// THE SERVER OWNS THE WARNING COPY. When an edit would delete a sign-off task or
// take a client's speaking point back, the API answers 409 with
// `requires_confirm` and a sentence. This component shows THAT sentence and
// re-sends with confirm: true — it never composes its own warning. Two sources
// of that text would drift, and the API's is the one that is actually enforcing.
//
// REORDER IS BUTTONS, NOT DRAG. Up/down works with a keyboard, works on a phone,
// needs no library and cannot half-drop a row. The list is short by nature — a
// deliverable with twenty tasks is a planning problem, not a UI one.

import { useState } from "react"
import { T, btnPrimary, btnSecondary } from "../../../../../lib/dashboard-theme"

const OWNERS = ["coach", "client", "both"] as const
const OWNER_LABEL: Record<string, string> = { coach: "Coach", client: "Client", both: "Both" }

const NAME_MAX = 200
const PROSE_MAX = 600

export type EditActivity = {
  id: string
  name: string
  owner: string
  status: string
  due_date: string | null
  is_signoff: boolean
  sort_order: number
}

// ── Small shared styles ────────────────────────────────────────────────────

const input: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: `1px solid ${T.BORDER}`,
  borderRadius: 7,
  color: T.TEXT,
  padding: "5px 8px",
  fontSize: 12,
  fontFamily: "inherit",
  minWidth: 0,
}

const iconBtn: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: `1px solid ${T.BORDER_SOFT}`,
  borderRadius: 6,
  color: T.MUTED,
  width: 24,
  height: 24,
  fontSize: 12,
  lineHeight: 1,
  cursor: "pointer",
  fontFamily: "inherit",
  display: "grid",
  placeItems: "center",
  flexShrink: 0,
}

const dangerBtn: React.CSSProperties = {
  ...iconBtn,
  color: T.ERROR,
  borderColor: "rgba(255,120,120,0.30)",
}

// ── The hard confirm ───────────────────────────────────────────────────────

/**
 * Shown only when the API refuses an edit with 409. The message is the server's,
 * verbatim. Deliberately NOT window.confirm: a native dialog cannot carry the
 * two-sentence explanation of what the client will lose, and this text is the
 * entire reason the gate exists.
 */
export function ConfirmGate({
  message, confirmLabel, onConfirm, onCancel, busy,
}: {
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  busy: boolean
}) {
  return (
    <div
      role="alertdialog"
      aria-label="Confirm this change"
      style={{
        marginTop: 8,
        padding: "10px 12px",
        borderRadius: 9,
        background: "rgba(255,120,120,0.08)",
        border: "1px solid rgba(255,120,120,0.35)",
      }}
    >
      <div style={{ fontSize: 12, lineHeight: "17px", color: T.TEXT }}>{message}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          style={{ ...btnPrimary, padding: "5px 12px", fontSize: 12, background: T.ERROR, color: T.INK_ON_ERROR, opacity: busy ? 0.6 : 1 }}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} style={{ ...btnSecondary, padding: "5px 12px", fontSize: 12 }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── One editable activity row ──────────────────────────────────────────────

export function ActivityEditRow({
  a, index, count, busy, onPatch, onDelete, onMove,
}: {
  a: EditActivity
  index: number
  count: number
  busy: boolean
  /** Resolves to the server's message when a confirm is required, else null. */
  onPatch: (patch: Record<string, unknown>, confirm?: boolean) => Promise<string | null>
  onDelete: (confirm?: boolean) => Promise<string | null>
  onMove: (dir: -1 | 1) => void
}) {
  const [name, setName] = useState(a.name)
  const [pending, setPending] = useState<null | { kind: "patch" | "delete"; patch?: Record<string, unknown>; message: string }>(null)

  // Rename commits on blur rather than per keystroke: one write per edit instead
  // of one per character, and no debounce timer to get wrong.
  async function commitName() {
    const t = name.trim()
    if (!t || t === a.name) { setName(a.name); return }
    const msg = await onPatch({ name: t })
    if (msg) setPending({ kind: "patch", patch: { name: t }, message: msg })
  }

  async function run(patch: Record<string, unknown>) {
    const msg = await onPatch(patch)
    if (msg) setPending({ kind: "patch", patch, message: msg })
  }

  return (
    <div style={{ padding: "7px 0", borderTop: index === 0 ? "none" : `1px solid ${T.BORDER_SOFT}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {/* Reorder */}
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
          <button type="button" style={{ ...iconBtn, height: 16 }} disabled={busy || index === 0}
            onClick={() => onMove(-1)} aria-label={`Move ${a.name} up`}>↑</button>
          <button type="button" style={{ ...iconBtn, height: 16 }} disabled={busy || index === count - 1}
            onClick={() => onMove(1)} aria-label={`Move ${a.name} down`}>↓</button>
        </span>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
          maxLength={NAME_MAX}
          disabled={busy}
          aria-label="Task name"
          style={{ ...input, flex: "1 1 160px" }}
        />

        <select
          value={a.owner}
          onChange={(e) => void run({ owner: e.target.value })}
          disabled={busy}
          aria-label="Task owner"
          style={{ ...input, flex: "0 0 auto" }}
        >
          {OWNERS.map((o) => <option key={o} value={o}>{OWNER_LABEL[o]}</option>)}
        </select>

        {/* THE SIGN-OFF FLAG. At most one per deliverable; clicking a different
            task moves it, which the API does in one transaction. */}
        <button
          type="button"
          onClick={() => void run({ is_signoff: !a.is_signoff })}
          disabled={busy}
          title={a.is_signoff
            ? "This task unlocks the client's speaking point"
            : "Make this the sign-off task"}
          style={{
            ...iconBtn,
            width: "auto",
            padding: "0 8px",
            fontSize: 10,
            fontWeight: 900,
            letterSpacing: 0.6,
            color: a.is_signoff ? T.INK_ON_ACCENT : T.DIM,
            background: a.is_signoff ? T.WRN_ORANGE : "rgba(255,255,255,0.05)",
            borderColor: a.is_signoff ? T.WRN_ORANGE : T.BORDER_SOFT,
          }}
        >
          SIGN-OFF
        </button>

        <button
          type="button"
          onClick={async () => {
            const msg = await onDelete()
            if (msg) setPending({ kind: "delete", message: msg })
          }}
          disabled={busy}
          style={dangerBtn}
          aria-label={`Delete ${a.name}`}
        >
          ×
        </button>
      </div>

      {pending && (
        <ConfirmGate
          message={pending.message}
          confirmLabel={pending.kind === "delete" ? "Delete anyway" : "Change anyway"}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={async () => {
            if (pending.kind === "delete") await onDelete(true)
            else await onPatch(pending.patch ?? {}, true)
            setPending(null)
          }}
        />
      )}
    </div>
  )
}

// ── Add a task ─────────────────────────────────────────────────────────────

export function AddActivityRow({ busy, onAdd }: {
  busy: boolean
  onAdd: (name: string, owner: string) => Promise<void>
}) {
  const [name, setName] = useState("")
  const [owner, setOwner] = useState<string>("client")

  async function submit() {
    const t = name.trim()
    if (!t) return
    await onAdd(t, owner)
    setName("") // owner persists: tasks are usually added in runs of one owner
  }

  return (
    <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void submit() }}
        placeholder="Add a task…"
        maxLength={NAME_MAX}
        disabled={busy}
        aria-label="New task name"
        style={{ ...input, flex: "1 1 160px" }}
      />
      <select value={owner} onChange={(e) => setOwner(e.target.value)} disabled={busy} aria-label="New task owner" style={input}>
        {OWNERS.map((o) => <option key={o} value={o}>{OWNER_LABEL[o]}</option>)}
      </select>
      <button type="button" onClick={() => void submit()} disabled={busy || !name.trim()}
        style={{ ...btnSecondary, padding: "5px 12px", fontSize: 12, opacity: busy || !name.trim() ? 0.5 : 1 }}>
        Add
      </button>
    </div>
  )
}

// ── The two prose fields ───────────────────────────────────────────────────

/**
 * Only rendered when the engagement is a Proof Project — these two fields exist
 * solely for that page, and showing them on every engagement would be asking
 * coaches to write copy nobody will ever read.
 */
export function DeliverableProse({
  speakingPoint, whyThisMatters, busy, onSave,
}: {
  speakingPoint: string | null
  whyThisMatters: string | null
  busy: boolean
  onSave: (patch: { speaking_point?: string | null; why_this_matters?: string | null }) => Promise<void>
}) {
  const [sp, setSp] = useState(speakingPoint ?? "")
  const [why, setWhy] = useState(whyThisMatters ?? "")
  const dirty = sp !== (speakingPoint ?? "") || why !== (whyThisMatters ?? "")

  const area: React.CSSProperties = {
    ...input, width: "100%", minHeight: 54, resize: "vertical", lineHeight: "17px", boxSizing: "border-box",
  }

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.BORDER_SOFT}` }}>
      <label style={{ display: "block", fontSize: 10, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: T.WRN_ORANGE }}>
        Speaking point
      </label>
      {/* The placeholder teaches the convention the column cannot enforce: this
          is quoted back to the client under "You can now say:", so it has to be
          written in THEIR voice. */}
      <textarea
        value={sp}
        onChange={(e) => setSp(e.target.value)}
        maxLength={PROSE_MAX}
        disabled={busy}
        placeholder="In their words — “I built a non-tender prediction model in R…”"
        style={{ ...area, marginTop: 5 }}
      />

      <label style={{ display: "block", marginTop: 9, fontSize: 10, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: T.MUTED }}>
        Why this matters
      </label>
      <textarea
        value={why}
        onChange={(e) => setWhy(e.target.value)}
        maxLength={PROSE_MAX}
        disabled={busy}
        placeholder="Your framing — why this claim lands with a hiring manager."
        style={{ ...area, marginTop: 5 }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          disabled={busy || !dirty}
          onClick={() => void onSave({ speaking_point: sp.trim() || null, why_this_matters: why.trim() || null })}
          style={{ ...btnSecondary, padding: "5px 12px", fontSize: 12, opacity: busy || !dirty ? 0.5 : 1 }}
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <span style={{ fontSize: 11, color: T.DIM }}>
          Hidden from the client until this deliverable is signed off.
        </span>
      </div>
    </div>
  )
}

// ── The engagement-level flag ──────────────────────────────────────────────

export function ProofProjectToggle({ on, busy, onToggle }: {
  on: boolean
  busy: boolean
  onToggle: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(!on)}
      disabled={busy}
      title={on
        ? "This is the client's Proof Project"
        : "Show this engagement as the client's Proof Project"}
      style={{
        fontSize: 9.5,
        fontWeight: 900,
        letterSpacing: 0.8,
        textTransform: "uppercase",
        borderRadius: 6,
        padding: "2px 7px",
        cursor: busy ? "default" : "pointer",
        fontFamily: "inherit",
        color: on ? T.INK_ON_ACCENT : T.DIM,
        background: on ? T.WRN_ORANGE : "rgba(255,255,255,0.05)",
        border: `1px solid ${on ? T.WRN_ORANGE : T.BORDER_SOFT}`,
        opacity: busy ? 0.6 : 1,
      }}
    >
      {on ? "★ Proof Project" : "Make Proof Project"}
    </button>
  )
}
