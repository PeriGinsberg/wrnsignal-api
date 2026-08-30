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
//
// THE CRITERIA ARE EDITABLE HERE, and that is the point of the screen rather
// than a convenience. Saving runs the lane once, immediately, and years_max,
// the posting window and the board filters are all applied when a run WRITES
// rows. Tightening them afterwards does nothing to what is already queued. So a
// lane saved wide lands several hundred jobs in the review queue on day one and
// the only way back out is to clear the queue. The first run is the one that has
// to be right, which is why these sit above the Save button and not behind it.

import { useCallback, useState } from "react"
import { T, card, eyebrow, input, btnPrimary, btnSecondary } from "../../../lib/dashboard-theme"
import { authFetch, locationLabel, type LaneFilters } from "./laneApi"
import { DEFAULT_POSTING_WINDOW } from "../../../lib/lanePostingWindow"
import { BoardFiltersEditor, PostedWithinField, YearsMaxField } from "./LaneCriteria"
import { DEFAULT_SENIORITY_BANDS } from "../../../lib/laneSeniority"

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
  filters?: {
    industries?: string[]
    excluded_industries?: string[]
    company_keywords?: string[]
    excluded_company_keywords?: string[]
    commitment_types?: string[]
  }
}

type ProposalResponse = {
  proposal: Proposal
  evidence: { yearsRule: string; sectors: Array<{ keyword: string; score: number }>; keywordFromResume: string | null }
  probe: null | { chosenKeyword: string | null; keywordChanged: boolean; titles: TitleProbe[]; droppedZero: string[] }
  /** The window the probe counts were measured over, so the screen need not assume one. */
  probe_days: number
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
  const [yearsMax, setYearsMax] = useState<number | null>(null)
  const [daysPosted, setDaysPosted] = useState<number>(DEFAULT_POSTING_WINDOW)
  const [filters, setFilters] = useState<LaneFilters>({})
  const [seniority, setSeniority] = useState<string[]>([...DEFAULT_SENIORITY_BANDS])

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
    // Seeded from the proposal, then owned by the coach. The window is the one
    // place the proposal has no opinion, so it starts at the default every lane
    // gets.
    setYearsMax(j.proposal.years_max ?? null)
    setDaysPosted(DEFAULT_POSTING_WINDOW)
    setFilters(j.proposal.filters ?? {})
    // The proposal has no opinion on the band either, so it starts where every
    // lane used to be pinned. Narrowing it here is the cheapest way to keep work
    // beneath the client out of the first queue.
    setSeniority([...DEFAULT_SENIORITY_BANDS])
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
        // All three come from the criteria box, not the proposal, because the
        // whole point of that box is that the coach gets to overrule the
        // derivation before the first run rather than after it.
        days_posted: daysPosted,
        seniority,
        years_max: yearsMax,
        companies: data.proposal.companies,
        exclusions: data.proposal.exclusions,
        // Sent explicitly. Omitting it would make the route fall back to the
        // profile — the same values today, but a coach who cleared a filter in
        // review would watch it reappear.
        filters,
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
  }, [data, clientProfileId, name, keyword, titles, yearsMax, daysPosted, seniority, filters, onCreated])

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
  // Only the titles still on the draft: removing one has to remove its share of
  // the estimate, or the number stops describing the lane being saved.
  const boardMatches = (probe?.titles ?? [])
    .filter((p) => titles.includes(p.title))
    .reduce((n, p) => n + (p.available || 0), 0)

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

      {/* How big this lane is before anything narrows it. Summed across titles,
          so a job matching two of them counts twice; it is a magnitude, not an
          inventory, and magnitude is the thing worth knowing before you save. */}
      {probe && boardMatches > 0 && (
        <p
          style={{
            fontSize: 12,
            color: boardMatches > 200 ? T.GOLD : T.MUTED,
            margin: "10px 0 0",
          }}
        >
          Across these titles the board reports {boardMatches} matches over the last {data!.probe_days} days, a job
          matching two titles counted twice. Treat it as the ceiling on the first run: the criteria below only
          bring it down, and the default two-week window is already narrower than this measurement.
        </p>
      )}

      {/* What the coach cannot change here. Location and the title-word
          exclusions stay read-only for the same reason they do on the edit
          screen: a bad location preset returns a convincing zero-result rather
          than an error. */}
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", margin: "16px 0 4px" }}>
        <Fact label="Location" value={locationLabel(data!.proposal.location)} />
        <Fact
          label="Excluded title words"
          value={data!.proposal.exclusions?.title_keywords?.join(", ") || "none"}
        />
      </div>
      <p style={{ fontSize: 12, color: T.DIM, margin: "0 0 16px" }}>{data!.evidence.yearsRule}</p>

      <section
        style={{
          border: `1px solid ${T.ORANGE_BORDER}`,
          borderRadius: 14,
          padding: "16px 18px",
          margin: "0 0 16px",
        }}
      >
        <div style={{ ...eyebrow, color: T.WRN_ORANGE, marginBottom: 6 }}>Search criteria</div>
        <p style={{ fontSize: 12, color: T.MUTED, margin: "0 0 14px" }}>
          Set these before you save. Saving runs the lane straight away, and these decide what that run puts in
          the review queue. They apply as a run writes rows, so tightening them later leaves everything already
          queued exactly where it is. The posting window is the strongest lever.
        </p>
        <div style={{ display: "flex", gap: 28, flexWrap: "wrap", marginBottom: 18 }}>
          <YearsMaxField value={yearsMax} disabled={phase === "saving"} onCommit={setYearsMax} />
          <PostedWithinField value={daysPosted} disabled={phase === "saving"} onChange={setDaysPosted} />
        </div>
        <BoardFiltersEditor
          filters={filters}
          seniority={seniority}
          disabled={phase === "saving"}
          onChange={setFilters}
          onSeniorityChange={setSeniority}
        />
      </section>

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
