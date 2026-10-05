"use client"

// The email that sends a client their SOW, edited before it goes. To is the
// prospect's email; "cc the parent" shows only when the record has a parent
// email. [SOW link] in the message becomes the button to their private link,
// and Send stays off without it. The signature is added by the email layout,
// so it is shown here read-only, as it will appear.
//
// POST .../sow/send; the rules are in lib/sow/send.ts.

import { useState } from "react"
import { btnPrimary } from "../../../../../lib/dashboard-theme"
import { signatureHtml } from "../../../../../lib/email/signature"
import { SOW_EMAIL_BODY_MAX, SOW_EMAIL_SUBJECT_MAX, SOW_LINK_TOKEN, hasSowLink } from "@/lib/sow/email"

const field: React.CSSProperties = {
  background: "#fff", color: "#08203F", border: "1px solid #C9D6E3", borderRadius: 8,
  padding: "7px 9px", fontSize: 14, fontFamily: "inherit", width: "100%", boxSizing: "border-box",
}
const small: React.CSSProperties = {
  background: "#fff", color: "#08203F", border: "1px solid #C9D6E3", borderRadius: 8,
  padding: "7px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
}

export function SendSowDialog({
  to, parentEmail, subject: initialSubject, body: initialBody, otherSent, resend, busy, error, onSend, onClose,
}: {
  to: string | null
  parentEmail: string | null
  subject: string
  body: string
  otherSent: string | null
  resend: boolean
  busy: boolean
  error: string | null
  onSend: (email: { subject: string; body: string; cc_parent: boolean }) => void
  onClose: () => void
}) {
  const [subject, setSubject] = useState(initialSubject)
  const [body, setBody] = useState(initialBody)
  const [ccParent, setCcParent] = useState(false)
  const missingLink = !hasSowLink(body)
  const ready = !!to && !!subject.trim() && !!body.trim() && !missingLink && !busy

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(8,32,63,0.45)", zIndex: 1000, overflowY: "auto", padding: "24px 12px" }}>
      <div role="dialog" aria-label={resend ? "Re-send SOW" : "Send SOW"} onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 680, margin: "0 auto", background: "#fff", borderRadius: 16, padding: 20, color: "#08203F" }}>
        <h2 style={{ margin: "0 0 14px", fontSize: 18 }}>{resend ? "Re-send the SOW" : "Send the SOW"}</h2>

        {otherSent && (
          <p role="note" style={{ background: "#FFF1E0", border: "1px solid #FEB06A", borderRadius: 8, padding: "8px 10px", fontSize: 13, margin: "0 0 12px" }}>
            The {otherSent} SOW is out now. Sending this one withdraws it: its link stops working and that package goes back to Draft.
          </p>
        )}
        {resend && (
          <p style={{ fontSize: 13, margin: "0 0 12px", color: "#4A6478" }}>
            This sends a new link. The link in the earlier email stops working.
          </p>
        )}

        <div style={{ fontSize: 13, marginBottom: 10 }}>
          <strong>To:</strong> {to ?? <span style={{ color: "#B42318" }}>no email on this record. Add one to send.</span>}
        </div>
        {parentEmail && (
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 10 }}>
            <input type="checkbox" checked={ccParent} onChange={(e) => setCcParent(e.target.checked)} />
            cc the parent ({parentEmail})
          </label>
        )}

        <label style={{ display: "block", fontSize: 12, fontWeight: 800, marginBottom: 4 }}>Subject</label>
        <input aria-label="Subject" value={subject} maxLength={SOW_EMAIL_SUBJECT_MAX} onChange={(e) => setSubject(e.target.value)} style={{ ...field, marginBottom: 10 }} />

        <label style={{ display: "block", fontSize: 12, fontWeight: 800, marginBottom: 4 }}>Message</label>
        <textarea aria-label="Message" value={body} maxLength={SOW_EMAIL_BODY_MAX} onChange={(e) => setBody(e.target.value)}
          style={{ ...field, minHeight: 280, resize: "vertical", lineHeight: 1.5 }} />
        <p style={{ fontSize: 12, color: missingLink ? "#B42318" : "#4A6478", margin: "4px 0 12px" }}>
          {missingLink
            ? `Put ${SOW_LINK_TOKEN} where the link to their SOW goes. It becomes a "View your Statement of Work" button.`
            : `${SOW_LINK_TOKEN} becomes a "View your Statement of Work" button.`}
        </p>

        <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 4 }}>Your signature (added automatically)</div>
        <div data-testid="sow-signature" style={{ border: "1px dashed #C9D6E3", borderRadius: 8, padding: 10, marginBottom: 14, overflowX: "auto" }}
          dangerouslySetInnerHTML={{ __html: signatureHtml() }} />

        {error && <div role="alert" style={{ fontSize: 13, color: "#B42318", marginBottom: 10 }}>{error}</div>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" style={small} onClick={onClose}>Cancel</button>
          <button type="button" disabled={!ready} onClick={() => onSend({ subject, body, cc_parent: ccParent })}
            style={{ ...btnPrimary, padding: "8px 18px", fontSize: 14, opacity: ready ? 1 : 0.5, cursor: ready ? "pointer" : "default" }}>
            {busy ? "Sending…" : resend ? "Re-send" : "Send"}
          </button>
        </div>
      </div>
    </div>
  )
}
