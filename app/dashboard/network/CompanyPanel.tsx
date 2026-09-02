"use client"

// COMPANY DETAILS, AS A PANEL OFF A CONTACT ROW.
//
// Companies stopped being a place you go and became something you look at while
// you are looking at a person. That is the whole argument for the merge: you
// almost never want to know about a company in the abstract, you want to know
// about it because you are about to write to someone who works there.
//
// It reuses CompanyCard rather than reimplementing it. The card already loads
// its own contacts lazily and owns its own edit state, so the panel's job is
// the shell, the scrim, and fetching the one company by id.
//
// FETCHES THE LIST AND PICKS ONE. There is a GET for a single company only as
// PATCH/DELETE at /api/network/companies/[companyId]; the list route is the one
// that returns contact_count, which the card renders. At 38 companies that is a
// small response, and this step is explicitly not moving work to the server.

import { useCallback, useEffect, useState } from "react"
import { LIGHT as S } from "../../../lib/theme/surfaces"
import { authFetch } from "./authFetch"
import { CompanyCard, type Company } from "./companies/CompanyCard"

export function CompanyPanel({
  companyId, onClose, onChanged,
}: {
  companyId: string | null
  onClose: () => void
  /** Bubbles a company edit up so the list can re-render names. */
  onChanged?: () => void
}) {
  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (id: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await authFetch("/api/network/companies")
      const j = await res.json()
      if (!res.ok || j?.ok === false) throw new Error(j?.error || `HTTP ${res.status}`)
      const hit = (j.companies ?? []).find((c: Company) => c.id === id) ?? null
      if (!hit) throw new Error("That company is no longer on your board.")
      setCompany(hit)
    } catch (e: any) {
      setError(e?.message || String(e))
      setCompany(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (companyId) void load(companyId)
    else setCompany(null)
  }, [companyId, load])

  // Escape closes. A panel that can only be dismissed by hitting a small × is a
  // panel people leave open.
  useEffect(() => {
    if (!companyId) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [companyId, onClose])

  if (!companyId) return null

  return (
    <div style={scrim} onClick={onClose} data-testid="company-panel-scrim">
      <aside
        style={panel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Company details"
        data-testid="company-panel"
      >
        <div style={header}>
          <span style={eyebrow}>Company</span>
          <button type="button" onClick={onClose} style={closeBtn} aria-label="Close">×</button>
        </div>

        {loading && <div style={note}>Loading…</div>}
        {error && <div style={{ ...note, color: S.meaning.error.ink }}>{error}</div>}

        {company && (
          <CompanyCard
            company={company}
            onChanged={(patch) => {
              setCompany((prev) => (prev ? { ...prev, ...patch } : prev))
              onChanged?.()
            }}
            // Deleting a company from inside a contact's panel is a trap: the
            // contact you came from would silently lose its company and the
            // panel would be describing something that no longer exists. The
            // board's own delete is the place for that. Omitting the prop hides
            // the Remove button entirely; see CompanyCard.

          />
        )}
      </aside>
    </div>
  )
}

const scrim: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 60,
  background: "rgba(19,41,74,0.32)",
  display: "flex",
  justifyContent: "flex-end",
}

const panel: React.CSSProperties = {
  width: "min(460px, 100%)",
  height: "100%",
  overflowY: "auto",
  background: S.page,
  borderLeft: `1px solid ${S.border}`,
  boxShadow: "-8px 0 28px rgba(19,41,74,0.14)",
  padding: "18px 18px 40px",
  boxSizing: "border-box",
}

const header: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 14,
}

const eyebrow: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 900,
  letterSpacing: 1.4,
  textTransform: "uppercase",
  color: S.text.muted,
}

const closeBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  fontSize: 22,
  lineHeight: 1,
  color: S.text.muted,
  cursor: "pointer",
  fontFamily: "inherit",
  padding: "0 4px",
}

const note: React.CSSProperties = {
  fontSize: 13.5,
  color: S.text.secondary,
  padding: "8px 2px",
}
