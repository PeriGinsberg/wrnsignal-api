"use client"

// The client's Google Drive workspace, with a Copy button for pasting the link
// into the welcome email. Made when the client clicks Let's Go
// (lib/sow/workspace.ts); nothing shows until then. On the Engagements tab and
// above the Plan.

import { useEffect, useState } from "react"
import { T } from "../../../../lib/dashboard-theme"
import { TYPE } from "../../../../lib/theme/surfaces"
import { getSupabaseBrowser } from "../../../../lib/supabase-browser"

export function DriveWorkspaceLink({ coachClientId, refreshKey = 0 }: { coachClientId: string | null; refreshKey?: number }) {
  const [url, setUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!coachClientId) return
    void (async () => {
      try {
        const { data: { session } } = await getSupabaseBrowser().auth.getSession()
        const token = session?.access_token || sessionStorage.getItem("signal_handoff_token")
        const res = await fetch(`/api/coach/coach-clients/${coachClientId}/drive-folder`, { headers: { Authorization: `Bearer ${token}` } })
        const j = await res.json().catch(() => ({}))
        setUrl(res.ok && j?.ok ? j.workspace?.url ?? null : null)
      } catch { /* nothing to show */ }
    })()
  }, [coachClientId, refreshKey])

  if (!url) return null
  return (
    <div data-testid="drive-workspace" style={{
      display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 12px", marginBottom: 14,
      borderRadius: 10, border: `1px solid ${T.BORDER_SOFT}`, background: T.GLASS, fontSize: TYPE.secondary, color: T.TEXT,
    }}>
      <span style={{ fontWeight: 800 }}>Drive workspace</span>
      <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: T.INK_LINK, wordBreak: "break-all" }}>{url}</a>
      <button type="button" onClick={async () => {
        try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* the link is visible to copy by hand */ }
      }} style={{
        background: "transparent", color: T.TEXT, border: `1px solid ${T.BORDER_SOFT}`, borderRadius: 8,
        padding: "4px 10px", fontSize: TYPE.micro, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
      }}>
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  )
}
