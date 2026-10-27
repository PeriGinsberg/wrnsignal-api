"use client"

// Supporters: up to two people the client invites to follow the search and
// suggest jobs. The client invites, resends, and removes; nobody else can.
//
// What a supporter sees is stated on the page, in full, because the client is
// the one deciding to share it: the tracker, JobFit and cover letter results,
// the profile and resume. Never their notes, and never anything a coach wrote.

import { useCallback, useEffect, useState } from "react"
import { LIGHT as S, action as actionStyle, status as statusStyle } from "../../../lib/theme/surfaces"
import { authFetch } from "../network/authFetch"
import { formatLong } from "../../../lib/localDate"
import { SectionHead } from "./BasicsSection"
import { Field, control } from "./controls"

type Supporter = {
  id: string
  email: string
  display_name: string
  status: "invited" | "active" | "expired"
  invite_expires_at: string | null
  accepted_at: string | null
}

async function call(path: string, init?: RequestInit): Promise<any> {
  try {
    const res = await authFetch(path, init)
    const j = await res.json().catch(() => null)
    return res.ok && j?.ok ? j : { ok: false, error: j?.error || "That didn't work. Try again." }
  } catch {
    return { ok: false, error: "Network error. Try again." }
  }
}

export function SupportersSection() {
  const [supporters, setSupporters] = useState<Supporter[] | null>(null)
  const [max, setMax] = useState(2)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [armed, setArmed] = useState<string | null>(null)

  const load = useCallback(async () => {
    const j = await call("/api/me/supporters")
    if (j.ok) {
      setSupporters(j.supporters)
      setMax(j.max)
    } else setErr(j.error)
  }, [])
  useEffect(() => { void load() }, [load])

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr(null); setNote(null)
    const j = await call("/api/me/supporters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: name, email }),
    })
    setBusy(false)
    if (!j.ok) { setErr(j.error); return }
    setName(""); setEmail("")
    setNote(j.email_sent ? `Invite sent to ${j.supporter.email}.` : "Invite saved, but the email did not send. Use Resend.")
    void load()
  }

  async function resend(s: Supporter) {
    setErr(null); setNote(null)
    const j = await call(`/api/me/supporters/${s.id}`, { method: "POST" })
    if (!j.ok) { setErr(j.error); return }
    setNote(j.email_sent ? `Invite sent again to ${s.email}.` : "The email did not send. Try again.")
    void load()
  }

  async function remove(s: Supporter) {
    setErr(null); setNote(null)
    const j = await call(`/api/me/supporters/${s.id}`, { method: "DELETE" })
    setArmed(null)
    if (!j.ok) { setErr(j.error); return }
    setNote(`${s.display_name} is no longer a supporter.`)
    void load()
  }

  const live = (supporters ?? []).filter((s) => s.status !== "expired")
  const full = live.length >= max

  return (
    <div>
      <SectionHead
        title="Supporters"
        blurb="Invite up to two people, like a parent or a mentor, to follow your search and suggest jobs. You can remove them at any time."
      />

      <div style={{ background: S.well, borderRadius: 12, padding: "14px 16px", fontSize: 14, color: S.text.secondary, lineHeight: "21px" }}>
        <strong style={{ color: S.text.primary }}>What a supporter sees:</strong> your Job Tracker, your JobFit and cover
        letter results, and your profile and resume. They can suggest jobs, which wait for you to add or pass on.
        <br />
        <strong style={{ color: S.text.primary }}>What they never see:</strong> your notes, or anything your coach writes.
        They cannot run JobFit or write cover letters.
      </div>

      {err && <p style={{ color: S.meaning.error.ink, fontWeight: 700, fontSize: 14 }}>{err}</p>}
      {note && <p style={{ color: S.meaning.done.ink, fontWeight: 700, fontSize: 14 }}>{note}</p>}

      {!supporters ? (
        <p style={{ color: S.text.muted, fontSize: 14.5 }}>Loading…</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 20 }}>
          {supporters.map((s) => {
            const st = statusStyle(S, s.status === "active" ? "done" : s.status === "invited" ? "attention" : "dormant")
            return (
              <div
                key={s.id}
                style={{
                  border: `1px solid ${S.borderSoft}`, borderRadius: 12, padding: "14px 16px",
                  display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15.5, fontWeight: 800, color: S.text.primary }}>{s.display_name}</div>
                  <div style={{ fontSize: 13.5, color: S.text.muted, overflowWrap: "anywhere" }}>{s.email}</div>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 6 }}>
                    <span style={st.dot} />
                    <span style={{ ...st.text, fontSize: 13 }}>
                      {s.status === "active" && `Supporter since ${formatLong(s.accepted_at)}`}
                      {s.status === "invited" && `Invited, link works until ${formatLong(s.invite_expires_at)}`}
                      {s.status === "expired" && "Invite expired"}
                    </span>
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {s.status !== "active" && (
                    <button onClick={() => void resend(s)} style={{ ...actionStyle(S, "optional"), borderRadius: 10, padding: "8px 14px", fontSize: 13.5, fontFamily: "inherit" }}>
                      Resend
                    </button>
                  )}
                  {armed === s.id ? (
                    <>
                      <button onClick={() => void remove(s)} style={{ ...actionStyle(S, "primary"), borderRadius: 10, padding: "8px 14px", fontSize: 13.5, fontFamily: "inherit" }}>
                        {s.status === "active" ? "Yes, remove" : "Yes, cancel"}
                      </button>
                      <button onClick={() => setArmed(null)} style={{ ...actionStyle(S, "optional"), borderRadius: 10, padding: "8px 14px", fontSize: 13.5, fontFamily: "inherit" }}>
                        Keep
                      </button>
                    </>
                  ) : (
                    <button onClick={() => setArmed(s.id)} style={{ ...actionStyle(S, "optional"), borderRadius: 10, padding: "8px 14px", fontSize: 13.5, fontFamily: "inherit" }}>
                      {s.status === "active" ? "Remove" : "Cancel invite"}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {supporters && !full && (
        <form onSubmit={invite} style={{ marginTop: 24 }}>
          <Field label="Their name" hint="Shown on jobs they suggest, like “Added by Mom”.">
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} style={control} />
          </Field>
          <Field label="Their email">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={control} />
          </Field>
          <button
            type="submit"
            disabled={busy}
            style={{ ...actionStyle(S, "primary"), borderRadius: 10, padding: "12px 20px", fontSize: 15, fontFamily: "inherit", opacity: busy ? 0.55 : 1 }}
          >
            {busy ? "Sending…" : "Send invite"}
          </button>
        </form>
      )}
      {supporters && full && (
        <p style={{ color: S.text.muted, fontSize: 14, marginTop: 20 }}>
          You have {max} supporters, the most you can have. Remove one to invite someone new.
        </p>
      )}
    </div>
  )
}
