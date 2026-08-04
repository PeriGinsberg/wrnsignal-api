"use client"

// Account: the things that are about your access rather than your job search.
//
// Sign out lands here, which retires the temporary nav entry added in step 2.
// It is a real button on a real page rather than an item in a list, because
// signing out is a deliberate act and the nav is where you go to keep working.
//
// The refund panel came from LegacyAccountPanel unchanged in behaviour: same
// window, same endpoint, same immediate revocation. What changed is that it
// stops shouting. It was a red-bordered button in a card headed ACCOUNT with no
// context; here it sits under the plan it refunds, and the confirmation is an
// in-page two-step rather than a window.confirm, so it matches how closing out
// a job and removing a resume version already work.

import { useState } from "react"
import { LIGHT as S, action as actionStyle, surfaceCard } from "../../../lib/theme/surfaces"
import { signOutCompletely } from "../../../lib/signOut"
import { authFetch } from "../network/authFetch"
import { SectionHead, type Profile } from "./BasicsSection"
import { formatLong } from "../../../lib/localDate"

/** Seven days, in ms. The window the marketing promise is written against. */
const REFUND_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export function AccountSection({ profile }: { profile: Profile }) {
  const [refunding, setRefunding] = useState(false)
  const [armed, setArmed] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)

  const purchasedAt = profile.purchase_date ? new Date(profile.purchase_date).getTime() : NaN
  const refundable =
    Number.isFinite(purchasedAt) &&
    !profile.refunded_at &&
    profile.active !== false &&
    Date.now() - purchasedAt <= REFUND_WINDOW_MS
  const daysLeft = refundable
    ? Math.max(0, Math.ceil((REFUND_WINDOW_MS - (Date.now() - purchasedAt)) / 86400000))
    : 0

  async function requestRefund() {
    if (refunding) return
    setRefunding(true); setErr(null)
    try {
      const res = await authFetch("/api/stripe/refund", { method: "POST" })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setErr(data?.error || "We couldn't process that. Email us and we'll sort it out.")
        setRefunding(false)
        return
      }
      // Access is revoked server-side, so the session has to go with it.
      await signOutCompletely()
    } catch {
      setErr("We couldn't process that. Email us and we'll sort it out.")
      setRefunding(false)
    }
  }

  return (
    <>
      <SectionHead
        title="Account"
        blurb="Your sign-in and your plan."
      />

      <div style={{ ...surfaceCard(S), borderRadius: 14, padding: "18px 22px" }}>
        <Row label="Signed in as" value={profile.email || "—"} />
        {profile.purchase_date && (
          <Row label="Member since" value={formatLong(profile.purchase_date) || "—"} />
        )}
      </div>

      {refundable && (
        <div style={{ ...surfaceCard(S), borderRadius: 14, padding: "18px 22px", marginTop: 12 }}>
          <div style={{ fontSize: 15.5, fontWeight: 800, color: S.text.primary }}>
            7-day money-back guarantee
          </div>
          <p style={{ color: S.text.muted, fontSize: 14.5, lineHeight: "21px", margin: "6px 0 0" }}>
            You have {daysLeft} day{daysLeft === 1 ? "" : "s"} left to ask for a full refund. It
            ends your access straight away.
          </p>
          {err && <div style={{ color: S.meaning.error.ink, fontSize: 14, marginTop: 12 }}>{err}</div>}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 16, flexWrap: "wrap" }}>
            {!armed ? (
              <button onClick={() => setArmed(true)} style={{ ...quiet, color: S.meaning.error.ink }}>
                Request a refund
              </button>
            ) : (
              <>
                <span style={{ fontSize: 14.5, color: S.text.primary, fontWeight: 700 }}>
                  Refund and close your access?
                </span>
                <button
                  onClick={requestRefund}
                  disabled={refunding}
                  style={{
                    background: S.meaning.error.ink, border: "none", color: "#FFFFFF", borderRadius: 10,
                    padding: "9px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer",
                    fontFamily: "inherit", opacity: refunding ? 0.6 : 1,
                  }}
                >
                  {refunding ? "Processing…" : "Yes, refund me"}
                </button>
                <button onClick={() => setArmed(false)} style={quiet}>Never mind</button>
              </>
            )}
          </div>
        </div>
      )}

      <div style={{ marginTop: 32, paddingTop: 26, borderTop: `1px solid ${S.borderSoft}` }}>
        <button
          onClick={() => { setSigningOut(true); void signOutCompletely() }}
          disabled={signingOut}
          style={{
            ...actionStyle(S, "optional"),
            borderRadius: 11, padding: "11px 22px", fontSize: 14.5, fontFamily: "inherit",
            opacity: signingOut ? 0.6 : 1,
          }}
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "baseline", justifyContent: "space-between",
        gap: 16, padding: "8px 0", flexWrap: "wrap",
      }}
    >
      <span
        style={{
          color: S.text.muted, fontSize: 11.5, fontWeight: 800,
          letterSpacing: 0.8, textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span style={{ color: S.text.primary, fontSize: 15, fontWeight: 700 }}>{value}</span>
    </div>
  )
}

const quiet: React.CSSProperties = {
  background: "none", border: "none", padding: 0, color: S.action.quietInk,
  fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
}
