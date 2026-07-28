"use client"

// Network Tracker — DAILY WORKLIST (the front door).
// Reads GET /api/network/worklist (contacts with next_due_at <= now, overdue
// first). Every mutation happens in a row and is followed by a re-fetch — no
// revalidatePath, no optimistic local due-date math.

import { useCallback, useEffect, useState } from "react"
import { T, card, headline } from "../../../lib/dashboard-theme"
import { authFetch } from "./authFetch"
import { DashboardSection } from "./DashboardPanels"
import { VIEW_LABELS } from "./vocab"
import { WorklistRow, type WorklistContact } from "./WorklistRow"
import { AddContactForm } from "./AddContactForm"

export default function NetworkWorklistPage() {
  const [contacts, setContacts] = useState<WorklistContact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await authFetch("/api/network/worklist")
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Could not load your worklist (${res.status})`)
      setContacts(j.contacts ?? [])
    } catch (e: any) {
      setError(e?.message || String(e))
      setContacts([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // next_due_at is in the past for everything the API returns, so "overdue"
  // here means due before today — today's items are the day's fresh work.
  const startOfToday = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime()
  const overdue = contacts.filter((c) => c.next_due_at && new Date(c.next_due_at).getTime() < startOfToday)

  return (
    <main style={{ padding: "28px 24px", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ ...headline }}>{VIEW_LABELS.dashboard.heading}</h1>
          <p style={{ color: T.MUTED, fontSize: 13, marginTop: 6 }}>
            {loading
              ? "Loading…"
              : contacts.length === 0
                ? "Nothing is due right now."
                : `${contacts.length} to touch${overdue.length > 0 ? ` · ${overdue.length} overdue` : ""}`}
          </p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          style={{
            background: T.GLASS,
            color: T.TEXT,
            border: `1px solid ${T.BORDER}`,
            borderRadius: 11,
            padding: "9px 14px",
            fontSize: 12,
            fontWeight: 800,
            cursor: "pointer",
            whiteSpace: "nowrap",
            flex: "0 0 auto",
          }}
        >
          + Add a contact
        </button>
      </div>

      {addOpen && <AddContactForm onClose={() => setAddOpen(false)} onCreated={load} />}

      {error && (
        <div style={{ ...card, marginTop: 18, borderColor: "rgba(255,120,120,0.35)", background: T.ERROR_BG }}>
          <div style={{ color: T.ERROR, fontSize: 13 }}>{error}</div>
          <button
            onClick={() => void load()}
            style={{
              marginTop: 12,
              background: T.GLASS,
              color: T.TEXT,
              border: `1px solid ${T.BORDER}`,
              borderRadius: 11,
              padding: "9px 14px",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      )}

      {!loading && !error && contacts.length === 0 && (
        <div style={{ ...card, marginTop: 18, textAlign: "center", padding: "40px 24px" }}>
          <div style={{ color: T.TEXT, fontSize: 15, fontWeight: 800 }}>Nothing due yet.</div>
          <div style={{ color: T.MUTED, fontSize: 13, marginTop: 8, lineHeight: "20px" }}>
            Add your first contact, or import your WRN list.
            <br />
            Once someone is in the pipeline, they show up here when it&apos;s time to touch them.
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20, flexWrap: "wrap" }}>
            <button
              onClick={() => setAddOpen(true)}
              style={{
                background: T.GRAD_PRIMARY,
                color: "#04060F",
                fontWeight: 900,
                fontSize: 12,
                border: "none",
                borderRadius: 11,
                padding: "11px 16px",
                cursor: "pointer",
              }}
            >
              Add a contact
            </button>
            <a
              href="/dashboard/network/import"
              style={{
                background: T.GLASS,
                color: T.TEXT,
                border: `1px solid ${T.BORDER}`,
                fontWeight: 700,
                fontSize: 12,
                borderRadius: 11,
                padding: "11px 16px",
                textDecoration: "none",
              }}
            >
              Import CSV
            </a>
          </div>
        </div>
      )}

      {contacts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
          {contacts.map((c) => (
            <WorklistRow key={c.id} contact={c} onChanged={load} />
          ))}
        </div>
      )}
    
      {/* Metrics sit BELOW the worklist, never above it: the due list is the
          product, and a user must see who to contact before any number. */}
      <DashboardSection />
    </main>
  )
}
