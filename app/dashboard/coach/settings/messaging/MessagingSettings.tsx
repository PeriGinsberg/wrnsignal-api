"use client"

// The signed-in coach's sending address (read-only: Peri sets it) and their
// plain-text signature, which is added to the end of every message they send.

import { useEffect, useState } from "react"
import { T, textarea, btnPrimary, label } from "../../../../../lib/dashboard-theme"
import { apiJson } from "../../_tasks/taskClient"
import { SavingSpinner } from "../../SavingSpinner"
import { SignaturePreview } from "../../_messaging/SignaturePreview"

type Settings = { sending_email: string | null; signature: string | null }

const SIGNATURE_MAX = 2000

export function MessagingSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [signature, setSignature] = useState("")
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const j = await apiJson<{ settings: Settings }>("/api/coach/messaging-settings")
        setSettings(j.settings)
        setSignature(j.settings.signature ?? "")
      } catch (e) {
        setLoadError((e instanceof Error && e.message) || "Couldn't load your messaging settings.")
      }
    })()
  }, [])

  async function save() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const j = await apiJson<{ settings: Settings }>("/api/coach/messaging-settings", {
        method: "PUT",
        body: JSON.stringify({ signature }),
      })
      setSettings(j.settings)
      setSignature(j.settings.signature ?? "")
      setSaved(true)
    } catch (e) {
      setError((e instanceof Error && e.message) || "Couldn't save the signature.")
    } finally {
      setSaving(false)
    }
  }

  if (loadError) return <p style={{ fontSize: 13, color: T.ERROR, margin: 0 }}>{loadError}</p>
  if (!settings) return <p style={{ fontSize: 13, color: T.MUTED, margin: 0 }}>Loading…</p>

  const unchanged = signature.trim() === (settings.signature ?? "").trim()

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 560 }}>
      <div>
        <span style={{ ...label, color: T.INK_LINK, display: "block", marginBottom: 6 }}>SENDING ADDRESS</span>
        <div style={{ fontSize: 14, color: settings.sending_email ? T.TEXT : T.ERROR }}>
          {settings.sending_email ?? "Not set up yet"}
        </div>
        <p style={{ fontSize: 12, color: T.DIM, margin: "4px 0 0" }}>
          Your messages come from this address, and replies go to it. Only Peri can change it.
        </p>
      </div>

      <div>
        <label htmlFor="messaging-signature" style={{ ...label, color: T.INK_LINK, display: "block", marginBottom: 6 }}>SIGNATURE</label>
        <textarea
          id="messaging-signature"
          style={{ ...textarea, minHeight: 140, fontSize: 13 }}
          value={signature}
          maxLength={SIGNATURE_MAX}
          placeholder={"Your name\nYour title\nPhone"}
          onChange={(e) => { setSignature(e.target.value); setSaved(false) }}
        />
        <p style={{ fontSize: 12, color: T.DIM, margin: "4px 0 0" }}>
          Plain text, added to the end of every message you send, with the WRN and SIGNAL logos under it.
        </p>
      </div>

      <div>
        <span style={{ ...label, color: T.INK_LINK, display: "block", marginBottom: 6 }}>HOW IT LOOKS</span>
        <SignaturePreview signature={signature} />
      </div>

      {error && <div style={{ fontSize: 13, color: T.ERROR, fontWeight: 700 }}>{error}</div>}

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || unchanged}
          style={{ ...btnPrimary, fontSize: 13, padding: "10px 18px", opacity: saving || unchanged ? 0.5 : 1, display: "inline-flex", alignItems: "center", gap: 8 }}
        >
          {saving && <SavingSpinner />}
          {saving ? "Saving…" : "Save signature"}
        </button>
        {saved && <span style={{ fontSize: 12, color: T.MUTED }}>Saved.</span>}
      </div>
    </div>
  )
}
