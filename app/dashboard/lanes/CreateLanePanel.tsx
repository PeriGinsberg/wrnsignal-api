"use client"

// "Create search lane" — propose, review, save.
//
// Three states, because the middle one is the whole point: a proposal derived
// from a client's intake text is a guess until the board has been asked, and the
// coach is the one who decides whether the guess is right. Saving straight from
// the profile would produce lanes that look reasonable and find nothing.
//
// The proposal call is slow — one board request per title for a baseline, plus
// one per title per candidate keyword — so the button says so before it is
// pressed, and the waiting state says what is happening rather than spinning.

import { useCallback, useState } from "react"
import { T, card, eyebrow, input, btnPrimary, btnSecondary } from "../../../lib/dashboard-theme"
import { authFetch, locationLabel } from "./laneApi"

type TitleProbe = { title: string; query: string; fetched: number; available: number; capped: boolean }

type Proposal = {
  client_profile_id: string
  name: string
  titles: string[]
  keyword: string | null
  location: { presets: string[]; radius_miles?: number }
  years_max: number | null
  companies: string[]
  exclusions: { companies?: string[]; title_keywords?: string[] }
}

type ProposalResponse = {
  proposal: Proposal
  evidence: { yearsRule: string; sectors: Array<{ keyword: string; score: number }>; keywordFromResume: string | null }
  probe: null | { chosenKeyword: string | null; keywordChanged: boolean; titles: TitleProbe[]; droppedZero: string[] }
  flags: string[]
}

export function CreateLanePanel({
  clientProfileId,
  clientName,
  onCreated,
}: {
  clientProfileId: string
  clientName?: string | null
  onCreated: () => void
}) {
  const [phase, setPhase] = useState<"idle" | "proposing" | "review" | "saving">("idle")
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ProposalResponse | null>(null)

  // Editable copies. The proposal is a draft; these are what actually get saved.
  const [name, setName] = useState("")
  const [keyword, setKeyword] = useState("")
  const [titles, setTitles] = useState<string[]>([])

  const propose = useCallback(async () => {
    setPhase("proposing")
    setError(null)
    const res = await authFetch(`/api/lanes/propose?client_profile_id=${encodeURIComponent(clientProfileId)}`)
    const j = await res.json().catch(() => ({}))
    if (!res.ok || !j.ok) {
      setError(j.error || "Could not build a proposal")
      setPhase("idle")
      return
    }
    setData(j)
    setName(j.proposal.name)
    setKeyword(j.proposal.keyword ?? "")
    setTitles(j.proposal.titles)
    setPhase("review")
  }, [clientProfileId])

  const save = useCallback(async () => {
    if (!data) return
    setPhase("saving")
    setError(null)
    const res = await authFetch("/api/lanes", {
      method: "POST",
      body: JSON.stringify({
        client_profile_id: clientProfileId,
        name: name.trim(),
        titles,
        // Empty input means no keyword. There is one representation of that.
        keyword: keyword.trim() || null,
        location: data.proposal.location,
        years_max: data.proposal.years_max,
        companies: data.proposal.companies,
        exclusions: data.proposal.exclusions,
      }),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok || !j.ok) {
      setError(j.error || "Could not create the lane")
      setPhase("review")
      return
    }
    // The lane exists even if its first run failed, so the panel closes either
    // way; the run outcome is surfaced by the queue that replaces it.
    if (j.run_error) {
      setError(`Lane created, but its first run failed: ${j.run_error}. The nightly sweep will retry it.`)
    }
    onCreated()
  }, [data, clientProfileId, name, keyword, titles, onCreated])

  // --- idle -----------------------------------------------------------------
  if (phase === "idle" || phase === "proposing") {
    return (
      <div style={{ ...card, padding: 24 }}>
        <div style={{ ...eyebrow, color: T.MUTED, marginBottom: 8 }}>No lanes yet</div>
        <p style={{ fontSize: 13, color: T.MUTED, margin: "0 0 4px" }}>
          A lane is a standing search that runs every night. This builds one from{" "}
          {clientName || "this client"}&apos;s target roles and locations, then checks every title against the job
          board before you save it.
        </p>
        <p style={{ fontSize: 12, color: T.DIM, margin: "0 0 16px" }}>
          Takes up to a minute — it runs one search per title, plus one per candidate keyword.
        </p>
        {error && (
          <p role="alert" style={{ fontSize: 13, color: T.ERROR, margin: "0 0 12px" }}>
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={propose}
          disabled={phase === "proposing"}
          style={{ ...btnPrimary, opacity: phase === "proposing" ? 0.6 : 1 }}
        >
          {phase === "proposing" ? "Checking the board…" : "Create search lane"}
        </button>
      </div>
    )
  }

  // --- review ---------------------------------------------------------------
  const probe = data?.probe
  const countFor = (t: string) => probe?.titles.find((p) => p.title === t)

  return (
    <div style={{ ...card, padding: 24 }}>
      <div style={{ ...eyebrow, color: T.WRN_ORANGE, marginBottom: 12 }}>Review before saving</div>

      {error && (
        <div
          role="alert"
          style={{
            ...card, borderColor: T.ERROR, background: T.ERROR_BG, color: T.ERROR,
            fontSize: 13, padding: "10px 14px", marginBottom: 14,
          }}
        >
          {error}
        </div>
      )}

      <label style={{ ...eyebrow, color: T.MUTED, display: "block", marginBottom: 4 }}>Lane name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} style={{ ...input, marginBottom: 14 }} />

      <label style={{ ...eyebrow, color: T.MUTED, display: "block", marginBottom: 4 }}>
        Keyword — appended to every title
      </label>
      <input
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="none"
        style={{ ...input, marginBottom: 4 }}
      />
      <p style={{ fontSize: 12, color: T.DIM, margin: "0 0 14px" }}>
        {probe?.keywordChanged
          ? `Chosen from board evidence${data?.evidence.keywordFromResume ? `, over "${data.evidence.keywordFromResume}" which the client's own words suggested` : ""}.`
          : "Leave empty for no keyword. It narrows every search this lane makes."}
      </p>

      <div style={{ ...eyebrow, color: T.MUTED, marginBottom: 6 }}>
        Titles — counts are what the board returned for each
      </div>
      {titles.length === 0 && (
        <p style={{ fontSize: 13, color: T.ERROR, margin: "0 0 12px" }}>
          No titles survived the check. There is no lane to save.
        </p>
      )}
      {titles.map((t) => {
        const c = countFor(t)
        return (
          <div
            key={t}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
              padding: "8px 0", borderBottom: `1px solid ${T.BORDER_SOFT}`, fontSize: 13, color: T.TEXT,
            }}
          >
            <span style={{ flex: 1 }}>
              {t}
              {keyword.trim() && <span style={{ color: T.DIM }}> + {keyword.trim()}</span>}
            </span>
            <span style={{ color: c && c.fetched > 0 ? T.MUTED : T.DIM, fontSize: 12, whiteSpace: "nowrap" }}>
              {c ? `${c.fetched}${c.capped ? `+ of ${c.available}` : ""} found` : "—"}
            </span>
            <button
              type="button"
              onClick={() => setTitles((prev) => prev.filter((x) => x !== t))}
              disabled={titles.length === 1}
              style={{
                background: "none", border: "none", fontSize: 12,
                color: titles.length === 1 ? T.DIM : T.MUTED,
                cursor: titles.length === 1 ? "not-allowed" : "pointer",
              }}
            >
              remove
            </button>
          </div>
        )
      })}

      {probe && probe.droppedZero.length > 0 && (
        <p style={{ fontSize: 12, color: T.DIM, margin: "10px 0 0" }}>
          Dropped for returning nothing: {probe.droppedZero.join(", ")}
        </p>
      )}

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", margin: "16px 0 4px" }}>
        <Fact label="Location" value={locationLabel(data!.proposal.location)} />
        <Fact
          label="Years max"
          value={data!.proposal.years_max == null ? "no ceiling" : String(data!.proposal.years_max)}
        />
        <Fact
          label="Excluded title words"
          value={data!.proposal.exclusions?.title_keywords?.join(", ") || "none"}
        />
      </div>
      <p style={{ fontSize: 12, color: T.DIM, margin: "0 0 16px" }}>{data!.evidence.yearsRule}</p>

      {(data?.flags.length ?? 0) > 0 && (
        <div style={{ ...card, padding: "12px 14px", background: T.WARNING_BG, borderColor: T.ORANGE_BORDER, marginBottom: 16 }}>
          {data!.flags.map((f, i) => (
            <p key={i} style={{ fontSize: 12, color: T.TEXT, margin: i ? "8px 0 0" : 0 }}>
              ⚠ {f}
            </p>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button
          type="button"
          onClick={save}
          disabled={phase === "saving" || !titles.length || !name.trim()}
          style={{ ...btnPrimary, opacity: phase === "saving" || !titles.length || !name.trim() ? 0.5 : 1 }}
        >
          {phase === "saving" ? "Saving and running…" : "Save and run"}
        </button>
        <button type="button" onClick={() => setPhase("idle")} disabled={phase === "saving"} style={btnSecondary}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ ...eyebrow, color: T.DIM, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, color: T.TEXT }}>{value}</div>
    </div>
  )
}
