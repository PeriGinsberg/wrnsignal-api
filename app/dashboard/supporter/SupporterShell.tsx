"use client"

// The supporter area's frame: the light ground, the wordmark, and sign out.
// No nav. A supporter has one place to be, and the client and coach navs both
// point at pages that refuse them.

import { LIGHT as S, action } from "../../../lib/theme/surfaces"
import { T } from "../../../lib/dashboard-theme"
import { signOutCompletely } from "../../../lib/signOut"

export function SupporterShell({ signedIn, children }: { signedIn: boolean; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: S.page, color: S.text.primary }}>
      <header
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
          padding: "16px 16px", maxWidth: 1080, margin: "0 auto",
        }}
      >
        <a href="/dashboard/supporter" style={{ textDecoration: "none", color: S.text.primary }}>
          <span style={{ fontSize: 22, fontWeight: 950, fontStyle: "italic", letterSpacing: -0.5 }}>SIGNAL</span>
          <span style={{ display: "block", width: 14, height: 3, background: T.WRN_ORANGE, borderRadius: 1, marginTop: 4 }} />
        </a>
        {signedIn && (
          <button
            onClick={() => void signOutCompletely()}
            style={{ ...action(S, "optional"), borderRadius: 10, padding: "8px 14px", fontSize: 13.5, fontFamily: "inherit" }}
          >
            Sign out
          </button>
        )}
      </header>
      <main style={{ maxWidth: 1080, margin: "0 auto", padding: "8px 16px 48px" }}>{children}</main>
    </div>
  )
}
