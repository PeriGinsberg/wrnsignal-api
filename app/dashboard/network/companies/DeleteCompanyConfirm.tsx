"use client"

// Delete confirmation for a company, with friction scaled to what is actually
// lost.
//
//   0 contacts  → plain confirm. Nothing is destroyed but an empty record.
//   N contacts  → the company NAME must be typed to enable the button.
//
// The asymmetry is the point. The contacts themselves are safe — company_id is
// ON DELETE SET NULL, so they become standalone — but the record of WHICH FIRM
// those people belonged to is gone permanently, with no undo and no way to
// reconstruct it. A one-click confirm is too cheap for that; a full re-type is
// proportionate, and only imposed when there is something to lose.

import { useState } from "react"
import { LIGHT as S } from "../../../../lib/theme/surfaces"

export function DeleteCompanyConfirm({
  name, contactCount, busy, onCancel, onConfirm,
}: {
  name: string
  contactCount: number
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const [typed, setTyped] = useState("")

  const needsTyping = contactCount > 0
  // Trimmed and case-insensitive: the friction that matters is having to type
  // the whole name deliberately, not reproducing its capitalisation. Being
  // stricter than that punishes "ibm" for "IBM" without adding real safety.
  const matches = typed.trim().toLowerCase() === name.trim().toLowerCase()
  const canDelete = !busy && (!needsTyping || matches)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Remove ${name}`}
      style={{
        position: "fixed", inset: 0, background: "rgba(19,41,74,0.45)", display: "flex",
        alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50,
      }}
    >
      <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 16, padding: 22, maxWidth: 460, width: "100%" }}>
        <h2 style={{ color: S.text.primary, fontSize: 16, fontWeight: 900, margin: "0 0 10px" }}>Remove {name}?</h2>

        {needsTyping ? (
          <>
            <p style={{ color: S.text.muted, fontSize: 13, lineHeight: "19px", margin: "0 0 14px" }}>
              Removing this company keeps its {contactCount} contact{contactCount === 1 ? "" : "s"} as
              standalone, not deleted.
            </p>
            <p style={{ color: S.text.muted, fontSize: 12, lineHeight: "18px", margin: "0 0 8px" }}>
              The record of which firm they belonged to is lost permanently. Type{" "}
              <strong style={{ color: S.text.primary }}>{name}</strong> to confirm.
            </p>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              aria-label="Type the company name to confirm"
              placeholder={name}
              autoFocus
              style={{ background: S.well, border: `1px solid ${S.border}`, borderRadius: 10, height: 42, padding: "0 12px", fontSize: 14, color: S.text.primary, fontFamily: "inherit", width: "100%", boxSizing: "border-box", marginBottom: 18 }}
            />
          </>
        ) : (
          <p style={{ color: S.text.muted, fontSize: 13, lineHeight: "19px", margin: "0 0 16px" }}>
            This company has no contacts. Removing it deletes the company record only.
          </p>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel} disabled={busy} style={cancelBtn}>Cancel</button>
          <button
            onClick={onConfirm}
            disabled={!canDelete}
            style={{
              background: canDelete ? S.meaning.error.accent : S.meaning.error.fill,
              color: canDelete ? "#FFFFFF" : S.text.dim,
              fontWeight: 900, borderRadius: 13, padding: "13px 18px", fontSize: 13,
              border: "none", cursor: canDelete ? "pointer" : "not-allowed",
            }}
          >
            {busy ? "Removing…" : "Remove company"}
          </button>
        </div>
      </div>
    </div>
  )
}

const cancelBtn: React.CSSProperties = {
  background: S.card, border: `1px solid ${S.border}`, color: S.text.secondary,
  borderRadius: 13, padding: "13px 18px", fontSize: 13, fontWeight: 800,
  cursor: "pointer", fontFamily: "inherit",
}
