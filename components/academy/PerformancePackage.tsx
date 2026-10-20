"use client"

// The two export buttons: the full Performance Package (a ZIP with the
// recordings) and the single ChatGPT Review document.
//
// THE ZIP IS BUILT HERE, IN THE COACH'S BROWSER. The route returns the text
// files and ten-minute signed URLs; this downloads each recording straight
// from storage and zips everything. A recording that will not download is
// listed in Recordings/README.md with the reason, never silently dropped.
//
// Works for any workbook or round: pass whichever id you have.

import { useState } from "react"
import { getSupabaseBrowser } from "@/lib/supabase-browser"
import { zipParts, type ZipEntry } from "@/lib/academy/zip"
import { T } from "@/lib/dashboard-theme"

type Pkg = {
  ok: boolean; error?: string; incomplete?: boolean; missing?: string[]
  partial: boolean; folder: string
  files: { path: string; content: string }[]
  recordings: { path: string; url: string | null; kind: string; question: number }[]
  no_answer: number[]; has_round: boolean
}

function save(blob: Blob, name: string) {
  const a = document.createElement("a")
  const href = URL.createObjectURL(blob)
  a.href = href
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 30_000)
}

export function PerformancePackage({ clientId, roundId, workbookId, compact }: {
  clientId: string; roundId?: string | null; workbookId?: string | null; compact?: boolean
}) {
  const [busy, setBusy] = useState<null | "zip" | "gpt">(null)
  const [status, setStatus] = useState("")
  const [err, setErr] = useState("")
  const [askPartial, setAskPartial] = useState<null | { kind: "zip" | "gpt"; missing: string[] }>(null)

  const fetchPkg = async (partial: boolean): Promise<Pkg> => {
    const { data: { session } } = await getSupabaseBrowser().auth.getSession()
    const q = new URLSearchParams()
    if (roundId) q.set("round", roundId)
    if (workbookId) q.set("workbook", workbookId)
    if (partial) q.set("partial", "1")
    const res = await fetch(`/api/coach/clients/${clientId}/performance-package?${q}`, {
      headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
    })
    const j = await res.json().catch(() => null)
    if (res.status === 409 && j?.incomplete) return j
    if (!res.ok || !j?.ok) throw new Error(j?.error ?? `Export failed (${res.status})`)
    return j
  }

  const run = async (kind: "zip" | "gpt", partial = false) => {
    setBusy(kind); setErr(""); setStatus("Preparing..."); setAskPartial(null)
    try {
      const pkg = await fetchPkg(partial)
      if (!pkg.ok && pkg.incomplete) { setAskPartial({ kind, missing: pkg.missing ?? [] }); setStatus(""); setBusy(null); return }
      if (kind === "gpt") {
        const f = pkg.files.find((x) => x.path === "ChatGPT_Review.md")!
        save(new Blob([f.content], { type: "text/markdown;charset=utf-8" }), `${pkg.folder}_ChatGPT_Review.md`)
        setStatus("Downloaded.")
      } else {
        const enc = new TextEncoder()
        const entries: ZipEntry[] = pkg.files.map((f) => ({ path: `${pkg.folder}/${f.path}`, data: enc.encode(f.content) }))
        const got: { path: string; ok: boolean; reason?: string }[] = []
        let i = 0
        for (const r of pkg.recordings) {
          i++
          setStatus(`Downloading recording ${i} of ${pkg.recordings.length}...`)
          if (!r.url) { got.push({ path: r.path, ok: false, reason: "the storage link could not be created" }); continue }
          try {
            const res = await fetch(r.url)
            if (!res.ok) throw new Error(`storage answered ${res.status}`)
            entries.push({ path: `${pkg.folder}/${r.path}`, data: new Uint8Array(await res.arrayBuffer()) })
            got.push({ path: r.path, ok: true })
          } catch (e: any) {
            got.push({ path: r.path, ok: false, reason: String(e?.message ?? e) })
          }
        }
        const readme = [
          "# Recordings", "",
          "Original recordings, as the student's browser made them. *_audio files are the separate audio track the transcript was made from.", "",
          ...(!pkg.has_round ? ["_[Missing: no practice round in this export, so no recordings]_"] : []),
          ...pkg.no_answer.map((n) => `- Q${n}: _[Missing: no answer was recorded for this question]_`),
          ...got.map((g) => `- ${g.path}: ${g.ok ? "included" : `_[Missing: not included: ${g.reason}]_`}`),
          "",
        ].join("\n")
        entries.push({ path: `${pkg.folder}/Recordings/README.md`, data: enc.encode(readme) })
        setStatus("Zipping...")
        const blob = new Blob(zipParts(entries) as BlobPart[], { type: "application/zip" })
        save(blob, `${pkg.folder}.zip`)
        const failed = got.filter((g) => !g.ok).length
        setStatus(`Downloaded${pkg.partial ? " (partial)" : ""}. ${got.length - failed} recording file${got.length - failed === 1 ? "" : "s"} included${failed ? `, ${failed} could not be downloaded (listed in Recordings/README.md)` : ""}.`)
      }
    } catch (e: any) {
      setErr(String(e?.message ?? e)); setStatus("")
    }
    setBusy(null)
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="button" disabled={busy !== null} onClick={() => void run("zip")} style={btn(true, compact)}>
          {busy === "zip" ? "Building..." : "Download Full Performance Package"}
        </button>
        <button type="button" disabled={busy !== null} onClick={() => void run("gpt")} style={btn(false, compact)}>
          {busy === "gpt" ? "Building..." : "Export for ChatGPT Review"}
        </button>
      </div>
      {askPartial && (
        <div style={{ fontSize: 14, lineHeight: "20px", color: T.TEXT }}>
          Not finished yet: {askPartial.missing.join(" and ")}.{" "}
          <button type="button" onClick={() => void run(askPartial.kind, true)}
            style={{ background: "none", border: "none", padding: 0, color: T.INK_LINK, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 14, textDecoration: "underline" }}>
            Export what is there anyway
          </button>
        </div>
      )}
      {status && <span style={{ fontSize: 14, color: T.MUTED }}>{status}</span>}
      {err && <span style={{ fontSize: 14, color: T.ERROR }} role="alert">{err}</span>}
    </div>
  )
}

function btn(primary: boolean, compact?: boolean): React.CSSProperties {
  return {
    padding: compact ? "8px 14px" : "10px 18px", borderRadius: 9, fontSize: compact ? 14 : 15, fontWeight: 800, minHeight: compact ? 36 : 40,
    cursor: "pointer", fontFamily: "inherit",
    border: primary ? "none" : `1px solid ${T.BORDER}`,
    background: primary ? T.GRAD_PRIMARY : "transparent",
    color: primary ? "var(--sig-ink-on-primary, #04060F)" : T.TEXT,
  }
}
