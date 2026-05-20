// app/positioning/phase2/[id]/items/[itemId]/page.tsx
//
// Phase 2 item detail screen — the per-item workflow surface.
// Handles all three interaction patterns:
//   - Pattern A (headline): auto-generate 1-3 options on first paint;
//     user picks radio or types override; accept/decline/regenerate.
//     D1 adds a synthesize_mode branch — when the populator emitted
//     synthesize_mode=true (no headline in the resume), the page hides
//     the "Current headline" block and shows an "ADD" badge + framing
//     copy "Add a summary statement" instead of "Refine your headline".
//
//   - Pattern B (bullet): user types response to question, generates
//     draft, then accept/edit/regenerate/decline. No skip — a bullet
//     always exists in the resume; it can be rewritten or declined,
//     not skipped (per FRD §5.3 semantic distinction). D1 leaves
//     this branch unchanged.
//
//   - Pattern C (gap): D1 inserts a NEW outcome-picker step between
//     "user accepts a draft" and "fires /decide". The 4-button picker
//     surfaces shape-appropriate compositional outcomes from C2:
//
//        1. "Update an existing bullet with this"  — D1 stub
//           (D2 ships the bullet picker; the button here shows a
//            "coming in next release" message and does NOT fire /decide)
//        2. "Add as a new bullet"                   — add_new_bullet
//        3. "Note for cover letter"                 — note_for_cover_letter
//        4. "This isn't something I've done"        — acknowledge_genuine_gap
//
//     Without this step, /decide would 400 on every gap accept
//     (compositional_outcome_required, introduced by C1/C2 backend).
//     D1 is the user-facing fix.
//
//   - Manual-entry mode: triggered on /draft 422 grounding failure;
//     user types final_text directly, bypasses validation. For gap
//     items the manual-entry accept also routes through the 4-button
//     picker — same flow as the AI-drafted path, manual_entry=true is
//     preserved on the final /decide call.
//
// SIGNAL look-and-feel: D1 applies the SIGNAL accent token palette
// (orange primaries, teal accents, Framer-matching border radius
// scale, uppercase letter-spacing eyebrow labels). Token values live
// in app/globals.css (--signal-*). Tailwind utilities like
// bg-signal-primary, rounded-signal-md, etc. reference them. v1.1
// will swap the tokens to the SIGNAL dark theme as a separate
// unified theming pass across selection + items + completion pages —
// the rest of the prototype keeps the light baseline today for
// consistency.
//
// Mobile-first: page padding is p-4 sm:p-8 (tighter on phones), the
// 4-button gap picker stacks vertically with 64px+ touch targets, and
// the action rows on PatternA wrap on narrow viewports.
//
// FRD: docs/Features/positioning-phase2-frd.md §5.3 section workflow

"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  apiCall,
  type Phase2RunResponse,
  type Phase2DraftResponse,
  type Phase2DecideResponse,
  type PhaseTwoItem,
} from "@/lib/positioning-prototype"
import {
  extractAllResumeBullets,
  type ResumeBulletWithSection,
} from "@/lib/positioning/v2/phase2/clientHelpers"

/**
 * The three compositional outcomes wired through the D1 gap picker.
 * "reword_existing_bullet" / "add_certification" / "add_to_skills_list"
 * / "add_tool_or_software" / "add_language" / "add_to_coursework" are
 * intentionally NOT in this set — D1's picker stubs the "Update existing
 * bullet" button (D2 ships the bullet picker) and the shape-routed add_*
 * outcomes aren't surfaced as picker buttons yet (frontend D2/D3 may add
 * them; today's UX is the 4-outcome decision the kickoff locked).
 */
type GapPickerOutcome =
  | "add_new_bullet"
  | "note_for_cover_letter"
  | "acknowledge_genuine_gap"

export default function Phase2ItemPage({
  params,
}: {
  params: Promise<{ id: string; itemId: string }>
}) {
  const router = useRouter()
  const [phase2RunId, setPhase2RunId] = useState("")
  const [itemId, setItemId] = useState("")

  // Fetch state
  const [viewState, setViewState] = useState<"loading" | "loaded" | "error">(
    "loading",
  )
  const [item, setItem] = useState<PhaseTwoItem | null>(null)
  const [error, setError] = useState({ status: 0, message: "" })

  // Action state
  const [actionInFlight, setActionInFlight] = useState<
    "generate" | "decide" | null
  >(null)
  const [actionError, setActionError] = useState("")

  // Manual-entry mode (422 fallback)
  const [manualEntryMode, setManualEntryMode] = useState(false)

  // Pattern-specific input state
  const [userInput, setUserInput] = useState("") // Patterns B/C textarea
  const [selectedDraftIndex, setSelectedDraftIndex] = useState<number | null>(
    null,
  )
  const [overrideText, setOverrideText] = useState("") // Pattern A override / B/C edit / manual
  const [editMode, setEditMode] = useState(false) // Pattern B/C: editing the draft

  // D1: gap-outcome step. For Pattern C items, "Accept" no longer fires
  // /decide immediately — it stashes the candidate final_text and reveals
  // the 4-button picker. The actual /decide fires when the user clicks
  // one of the outcome buttons (or returns null if they click Back).
  const [gapOutcomeStep, setGapOutcomeStep] = useState(false)
  const [pendingFinalText, setPendingFinalText] = useState<string>("")
  const [pendingManualEntry, setPendingManualEntry] = useState(false)

  // D2: bullet-picker sub-step. When the user clicks "Update an existing
  // bullet with this" in GapOutcomePicker, we transition to BulletPickerView
  // (instead of firing /decide). originalResumeText drives the "show all
  // bullets" expansion. The actual /decide fires from BulletPickerView's
  // onSelect via handleRewordExistingDecide below.
  const [bulletPickerStep, setBulletPickerStep] = useState(false)
  const [originalResumeText, setOriginalResumeText] = useState<string>("")

  // ──────────────────────────────────────────────────────────────────────
  // EFFECTS
  // ──────────────────────────────────────────────────────────────────────

  // Fetch run + find item on mount
  useEffect(() => {
    async function load() {
      const { id, itemId: iid } = await params
      setPhase2RunId(id)
      setItemId(iid)
      const result = await apiCall<Phase2RunResponse>(
        `/api/positioning/v2/phase2/${id}`,
      )
      if (!result.ok) {
        setError({
          status: result.status,
          message:
            result.error + (result.detail ? `: ${result.detail}` : ""),
        })
        setViewState("error")
        return
      }
      const found = result.data.state.items.find((i) => i.id === iid)
      if (!found) {
        setError({ status: 404, message: "item_not_found" })
        setViewState("error")
        return
      }
      setItem(found)
      // D2: stash the original resume_text from the GET response. The
      // bullet picker extracts selectable bullets client-side via
      // extractAllResumeBullets(originalResumeText). Empty string OK —
      // the picker handles the empty-resume edge case (rare but
      // possible when persona.resume_text is null).
      setOriginalResumeText(result.data.original_resume_text ?? "")
      if (found.type === "bullet" || found.type === "gap") {
        setUserInput(found.user_response ?? "")
      }
      setViewState("loaded")
    }
    load()
  }, [params])

  // D2: derive the full bullet list from the resume text once per load.
  // Memoized so re-renders of the picker don't re-parse 4kb of resume
  // text on every keystroke / state flip.
  const allResumeBullets = useMemo(
    () => extractAllResumeBullets(originalResumeText),
    [originalResumeText],
  )

  // Auto-generate Pattern A drafts on first paint (cache miss + not decided)
  useEffect(() => {
    if (viewState !== "loaded" || !item) return
    if (item.type !== "headline") return
    if (item.draft_options.length > 0) return
    if (item.accepted || item.declined || item.skipped) return
    if (actionInFlight) return
    void handleGenerate(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewState, item])

  // ──────────────────────────────────────────────────────────────────────
  // ACTION HANDLERS
  // ──────────────────────────────────────────────────────────────────────

  async function handleGenerate(regenerate: boolean) {
    if (!item) return
    setActionInFlight("generate")
    setActionError("")

    const body: Record<string, unknown> = {
      item_id: item.id,
      draft_type: item.type,
      regenerate,
    }
    if (item.type === "bullet" || item.type === "gap") {
      if (!userInput.trim()) {
        setActionError("Please type a response first.")
        setActionInFlight(null)
        return
      }
      body.user_input = userInput
    }

    const result = await apiCall<Phase2DraftResponse>(
      `/api/positioning/v2/phase2/${phase2RunId}/draft`,
      { method: "POST", body: JSON.stringify(body) },
    )

    if (!result.ok) {
      if (result.status === 422) {
        // Grounding failed — enter manual-entry mode per FRD §6.9.1
        setManualEntryMode(true)
        if (item.type === "bullet") {
          setOverrideText(item.original_bullet)
        } else {
          setOverrideText("")
        }
      } else {
        setActionError(
          result.error + (result.detail ? `: ${result.detail}` : ""),
        )
      }
      setActionInFlight(null)
      return
    }

    // For Patterns B/C, refetch run to pick up server-written question_asked
    // (the /draft response shape doesn't include it; see commit 2 design note).
    // For Pattern A, just update draft_options locally.
    if (item.type === "headline") {
      setItem({ ...item, draft_options: result.data.drafts })
      setSelectedDraftIndex(null)
    } else {
      const refetch = await apiCall<Phase2RunResponse>(
        `/api/positioning/v2/phase2/${phase2RunId}`,
      )
      if (refetch.ok) {
        const updated = refetch.data.state.items.find((i) => i.id === item.id)
        if (updated) setItem(updated)
      } else {
        // Fallback: at least show the draft we just got
        setItem({
          ...item,
          draft: result.data.drafts[0],
          user_response: userInput,
        })
      }
      setEditMode(false)
      setOverrideText("")
    }
    setActionInFlight(null)
  }

  async function handleAccept() {
    if (!item) return
    setActionError("")

    // D1: gap items don't fire /decide on Accept — they show the 4-button
    // outcome picker. Compute the final_text we'd send, stash it, then
    // flip the gapOutcomeStep flag so the picker renders. The actual
    // /decide call happens in handleGapOutcomeDecide below when the
    // user picks an outcome.
    if (item.type === "gap") {
      let finalText: string | null = null

      if (manualEntryMode) {
        if (!overrideText.trim()) {
          setActionError("Please type your content first.")
          return
        }
        finalText = overrideText
      } else if (editMode && overrideText.trim()) {
        finalText = overrideText
      } else if (item.draft) {
        finalText = item.draft
      } else {
        setActionError("Generate a draft first.")
        return
      }

      setPendingFinalText(finalText)
      setPendingManualEntry(manualEntryMode)
      setGapOutcomeStep(true)
      return
    }

    // Headline + bullet — existing flow fires /decide immediately.
    setActionInFlight("decide")
    const body: Record<string, unknown> = {
      item_id: item.id,
      decision: "accept",
    }

    if (manualEntryMode) {
      if (!overrideText.trim()) {
        setActionError("Please type your content first.")
        setActionInFlight(null)
        return
      }
      body.edited_text = overrideText
      body.manual_entry = true
    } else if (item.type === "headline") {
      if (overrideText.trim()) {
        body.edited_text = overrideText
      } else if (selectedDraftIndex !== null) {
        body.selected_draft_index = selectedDraftIndex
      } else {
        setActionError("Pick an option or type your own.")
        setActionInFlight(null)
        return
      }
    } else {
      // Pattern B (bullet)
      if (editMode && overrideText.trim()) {
        body.edited_text = overrideText
      }
      // Else: backend uses item.draft via final_text resolution
    }

    const result = await apiCall<Phase2DecideResponse>(
      `/api/positioning/v2/phase2/${phase2RunId}/decide`,
      { method: "POST", body: JSON.stringify(body) },
    )

    if (!result.ok) {
      setActionError(
        result.error + (result.detail ? `: ${result.detail}` : ""),
      )
      setActionInFlight(null)
      return
    }

    router.push(`/positioning/phase2/${phase2RunId}`)
  }

  /**
   * D1: fire /decide with the chosen compositional_outcome for a gap.
   * Called from the 4-button picker (add_new_bullet, note_for_cover_letter,
   * acknowledge_genuine_gap). The pendingFinalText was stashed by
   * handleAccept above.
   *
   * D2 added the parallel handleRewordExistingDecide below for the
   * reword_existing_bullet path — the bullet picker produces the
   * target_bullet_text + this handler doesn't need to know about it.
   */
  async function handleGapOutcomeDecide(outcome: GapPickerOutcome) {
    if (!item) return
    setActionInFlight("decide")
    setActionError("")

    const body: Record<string, unknown> = {
      item_id: item.id,
      decision: "accept",
      edited_text: pendingFinalText,
      compositional_outcome: outcome,
    }
    if (pendingManualEntry) {
      body.manual_entry = true
    }

    const result = await apiCall<Phase2DecideResponse>(
      `/api/positioning/v2/phase2/${phase2RunId}/decide`,
      { method: "POST", body: JSON.stringify(body) },
    )

    if (!result.ok) {
      setActionError(
        result.error + (result.detail ? `: ${result.detail}` : ""),
      )
      setActionInFlight(null)
      return
    }

    router.push(`/positioning/phase2/${phase2RunId}`)
  }

  /**
   * D2: fire /decide with compositional_outcome="reword_existing_bullet"
   * + the bullet the user picked. Called from BulletPickerView's onSelect.
   *
   * pendingFinalText was stashed by handleAccept (the AI-drafted reword
   * text or user edit). target_bullet_text is the verbatim resume line
   * the user picked — preserves the verbatim invariant resumeComposer's
   * locate-and-replace depends on (FRD §6.10). Backend C1 also validates
   * the substring match server-side; we don't double-check client-side.
   */
  async function handleRewordExistingDecide(targetBulletText: string) {
    if (!item) return
    setActionInFlight("decide")
    setActionError("")

    const body: Record<string, unknown> = {
      item_id: item.id,
      decision: "accept",
      edited_text: pendingFinalText,
      compositional_outcome: "reword_existing_bullet",
      target_bullet_text: targetBulletText,
    }
    if (pendingManualEntry) {
      body.manual_entry = true
    }

    const result = await apiCall<Phase2DecideResponse>(
      `/api/positioning/v2/phase2/${phase2RunId}/decide`,
      { method: "POST", body: JSON.stringify(body) },
    )

    if (!result.ok) {
      setActionError(
        result.error + (result.detail ? `: ${result.detail}` : ""),
      )
      setActionInFlight(null)
      return
    }

    router.push(`/positioning/phase2/${phase2RunId}`)
  }

  async function handleDeclineOrSkip(kind: "decline" | "skip") {
    if (!item) return
    setActionInFlight("decide")
    setActionError("")

    const result = await apiCall<Phase2DecideResponse>(
      `/api/positioning/v2/phase2/${phase2RunId}/decide`,
      {
        method: "POST",
        body: JSON.stringify({ item_id: item.id, decision: kind }),
      },
    )

    if (!result.ok) {
      setActionError(
        result.error + (result.detail ? `: ${result.detail}` : ""),
      )
      setActionInFlight(null)
      return
    }

    router.push(`/positioning/phase2/${phase2RunId}`)
  }

  // ──────────────────────────────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────────────────────────────

  if (viewState === "loading") {
    return <div className="p-4 sm:p-8 text-neutral-500 text-sm">Loading item…</div>
  }

  if (viewState === "error") {
    return (
      <div className="p-4 sm:p-8 max-w-2xl">
        <h1 className="text-2xl font-semibold text-red-700">Error</h1>
        <p className="mt-2 text-neutral-700">
          {error.status}: {error.message}
        </p>
        <a
          href={`/positioning/phase2/${phase2RunId}`}
          className="mt-4 inline-block text-sm text-neutral-600 underline"
        >
          ← Back to selection screen
        </a>
      </div>
    )
  }

  if (!item) return null

  const isDecided = item.accepted || item.declined || item.skipped

  // D1: page-title copy + the ADD/REPLACE badge are headline-shape aware.
  // The selection-screen card label stays as-is in D1 (v1.1 will update
  // itemPopulator's headlineLabel() template alongside the dark-theme pass).
  let pageTitle: string
  if (item.type === "headline") {
    pageTitle = item.synthesize_mode
      ? "Add a summary statement"
      : "Refine your headline"
  } else if (item.type === "bullet") {
    pageTitle = "Reframe a bullet"
  } else {
    pageTitle = "Address a gap"
  }

  const showHeadlineBadge = item.type === "headline" && !isDecided
  const isSynthesize = item.type === "headline" && item.synthesize_mode

  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <a
          href={`/positioning/phase2/${phase2RunId}`}
          className="text-sm text-neutral-500 hover:text-neutral-900"
        >
          ← Back to selection
        </a>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-neutral-900">
            {pageTitle}
          </h1>
          {showHeadlineBadge && (
            <span
              className={`text-[10px] uppercase tracking-[0.14em] font-bold px-2 py-1 rounded-signal-pill ${
                isSynthesize
                  ? "bg-signal-primary text-signal-primary-foreground"
                  : "bg-signal-accent-soft text-signal-accent-foreground"
              }`}
            >
              {isSynthesize ? "ADD" : "REPLACE"}
            </span>
          )}
        </div>
      </div>

      {/* Body — branch on state */}
      {isDecided ? (
        <DecidedView item={item} />
      ) : bulletPickerStep && item.type === "gap" ? (
        <BulletPickerView
          pendingFinalText={pendingFinalText}
          suggestedBullets={item.suggested_bullets_for_reword ?? []}
          allResumeBullets={allResumeBullets}
          onSelect={handleRewordExistingDecide}
          onBack={() => setBulletPickerStep(false)}
          actionInFlight={actionInFlight}
        />
      ) : gapOutcomeStep && item.type === "gap" ? (
        <GapOutcomePicker
          pendingFinalText={pendingFinalText}
          onPick={handleGapOutcomeDecide}
          onPickUpdateExisting={() => setBulletPickerStep(true)}
          onCancel={() => {
            setGapOutcomeStep(false)
            setPendingFinalText("")
            setPendingManualEntry(false)
          }}
          actionInFlight={actionInFlight}
        />
      ) : manualEntryMode ? (
        <ManualEntryView
          overrideText={overrideText}
          setOverrideText={setOverrideText}
          onAccept={handleAccept}
          onCancel={() => {
            setManualEntryMode(false)
            setOverrideText("")
          }}
          actionInFlight={actionInFlight}
          itemType={item.type}
        />
      ) : item.type === "headline" ? (
        <PatternAView
          item={item}
          selectedDraftIndex={selectedDraftIndex}
          setSelectedDraftIndex={setSelectedDraftIndex}
          overrideText={overrideText}
          setOverrideText={setOverrideText}
          onAccept={handleAccept}
          onDecline={() => handleDeclineOrSkip("decline")}
          onRegenerate={() => handleGenerate(true)}
          actionInFlight={actionInFlight}
        />
      ) : (
        <PatternBCView
          item={item}
          userInput={userInput}
          setUserInput={setUserInput}
          overrideText={overrideText}
          setOverrideText={setOverrideText}
          editMode={editMode}
          setEditMode={setEditMode}
          onGenerate={() => handleGenerate(false)}
          onRegenerate={() => handleGenerate(true)}
          onAccept={handleAccept}
          onDecline={() => handleDeclineOrSkip("decline")}
          onSkip={() => handleDeclineOrSkip("skip")}
          actionInFlight={actionInFlight}
        />
      )}

      {/* Action error */}
      {actionError && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-signal-sm text-sm text-red-800">
          {actionError}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Subcomponents
// ============================================================================

/** Reusable eyebrow label — SIGNAL pattern (uppercase + tracking + small + semibold). */
function EyebrowLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`text-[11px] uppercase tracking-[0.12em] text-neutral-500 font-semibold mb-1 ${className}`}>
      {children}
    </div>
  )
}

function DecidedView({ item }: { item: PhaseTwoItem }) {
  const decisionKind = item.accepted
    ? "Accepted"
    : item.declined
      ? "Declined"
      : "Skipped"
  const decisionColor = item.accepted
    ? "bg-green-50 border-green-200 text-green-800"
    : item.declined
      ? "bg-red-50 border-red-200 text-red-800"
      : "bg-neutral-100 border-neutral-200 text-neutral-700"

  return (
    <div>
      <div className={`p-3 rounded-signal-sm border ${decisionColor} text-sm`}>
        This item was <strong>{decisionKind.toLowerCase()}</strong>
        {item.decided_at &&
          ` on ${new Date(item.decided_at).toLocaleString()}`}
        {item.manual_entry && " (manual entry)"}.
      </div>
      {item.accepted && item.final_text && (
        <div className="mt-4">
          <EyebrowLabel>Final content</EyebrowLabel>
          <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-signal-sm text-sm text-neutral-900 whitespace-pre-wrap">
            {item.final_text}
          </div>
        </div>
      )}
    </div>
  )
}

function PatternAView({
  item,
  selectedDraftIndex,
  setSelectedDraftIndex,
  overrideText,
  setOverrideText,
  onAccept,
  onDecline,
  onRegenerate,
  actionInFlight,
}: {
  item: Extract<PhaseTwoItem, { type: "headline" }>
  selectedDraftIndex: number | null
  setSelectedDraftIndex: (n: number | null) => void
  overrideText: string
  setOverrideText: (s: string) => void
  onAccept: () => void
  onDecline: () => void
  onRegenerate: () => void
  actionInFlight: "generate" | "decide" | null
}) {
  const isGenerating = actionInFlight === "generate"
  const isDeciding = actionInFlight === "decide"

  return (
    <div className="space-y-6">
      {/* Current headline OR synthesize-mode notice */}
      {item.synthesize_mode ? (
        <div>
          <EyebrowLabel>Current summary</EyebrowLabel>
          <div className="p-3 bg-neutral-50 border border-dashed border-neutral-300 rounded-signal-sm text-sm text-neutral-500 italic">
            No current summary — we&rsquo;ll add one.
          </div>
        </div>
      ) : (
        <div>
          <EyebrowLabel>Current headline</EyebrowLabel>
          <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-signal-sm text-sm text-neutral-900">
            {item.original}
          </div>
        </div>
      )}

      {/* Draft options */}
      <div>
        <EyebrowLabel className="mb-2">
          {item.synthesize_mode ? "Suggested summaries" : "Suggested reframes"}
        </EyebrowLabel>
        {isGenerating && item.draft_options.length === 0 ? (
          <div className="text-sm text-neutral-500 italic">
            Generating options…
          </div>
        ) : (
          <div className="space-y-2">
            {item.draft_options.map((option, idx) => (
              <label
                key={idx}
                className={`block p-3 rounded-signal-sm border cursor-pointer transition-colors ${
                  selectedDraftIndex === idx
                    ? "border-signal-accent bg-signal-accent-soft"
                    : "border-neutral-200 hover:border-neutral-400"
                }`}
              >
                <input
                  type="radio"
                  name="draft"
                  checked={selectedDraftIndex === idx}
                  onChange={() => {
                    setSelectedDraftIndex(idx)
                    setOverrideText("")
                  }}
                  className="mr-2"
                />
                <span className="text-sm text-neutral-900">{option}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Override */}
      <div>
        <EyebrowLabel>Or write your own</EyebrowLabel>
        <textarea
          value={overrideText}
          onChange={(e) => {
            setOverrideText(e.target.value)
            if (e.target.value.trim()) setSelectedDraftIndex(null)
          }}
          rows={2}
          placeholder={item.synthesize_mode
            ? "Type a custom summary…"
            : "Type a custom headline…"}
          className="w-full px-3 py-2 border border-neutral-300 rounded-signal-sm text-sm focus:outline-none focus:border-signal-accent"
        />
      </div>

      {/* Actions */}
      <div className="pt-4 border-t border-neutral-200">
        <div className="text-xs text-neutral-500 italic mb-3">
          Note: this decision will be final.
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onAccept}
            disabled={
              isDeciding ||
              isGenerating ||
              (selectedDraftIndex === null && !overrideText.trim())
            }
            className="px-4 py-2 min-h-[44px] bg-signal-primary text-signal-primary-foreground text-sm font-bold rounded-signal-md hover:bg-signal-primary-hover disabled:opacity-50"
          >
            {isDeciding ? "Accepting…" : "Accept"}
          </button>
          <button
            onClick={onRegenerate}
            disabled={isDeciding || isGenerating}
            className="px-4 py-2 min-h-[44px] border border-neutral-300 text-neutral-700 text-sm font-semibold rounded-signal-md hover:bg-neutral-50 disabled:opacity-50"
          >
            {isGenerating ? "Regenerating…" : "Regenerate"}
          </button>
          <button
            onClick={onDecline}
            disabled={isDeciding || isGenerating}
            className="ml-auto px-4 py-2 min-h-[44px] text-neutral-600 text-sm font-semibold hover:text-neutral-900 disabled:opacity-50"
          >
            Decline
          </button>
        </div>
      </div>
    </div>
  )
}

function PatternBCView({
  item,
  userInput,
  setUserInput,
  overrideText,
  setOverrideText,
  editMode,
  setEditMode,
  onGenerate,
  onRegenerate,
  onAccept,
  onDecline,
  onSkip,
  actionInFlight,
}: {
  item: Extract<PhaseTwoItem, { type: "bullet" | "gap" }>
  userInput: string
  setUserInput: (s: string) => void
  overrideText: string
  setOverrideText: (s: string) => void
  editMode: boolean
  setEditMode: (b: boolean) => void
  onGenerate: () => void
  onRegenerate: () => void
  onAccept: () => void
  onDecline: () => void
  onSkip: () => void
  actionInFlight: "generate" | "decide" | null
}) {
  const isGenerating = actionInFlight === "generate"
  const isDeciding = actionInFlight === "decide"
  const hasDraft = item.draft !== null
  const isBullet = item.type === "bullet"

  return (
    <div className="space-y-6">
      {/* Context */}
      <div>
        <EyebrowLabel>
          {isBullet ? "Original bullet" : "Gap to address"}
        </EyebrowLabel>
        <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-signal-sm text-sm text-neutral-900">
          {isBullet
            ? (item as Extract<PhaseTwoItem, { type: "bullet" }>)
                .original_bullet
            : (item as Extract<PhaseTwoItem, { type: "gap" }>)
                .gap_description}
        </div>
      </div>

      <div>
        <EyebrowLabel>Job description context</EyebrowLabel>
        <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-signal-sm text-sm text-neutral-900">
          {item.jd_context}
        </div>
      </div>

      {/* Question */}
      <div>
        <EyebrowLabel>Question</EyebrowLabel>
        <div className="text-sm text-neutral-900 italic">
          {item.question_asked ??
            "(No question available for this item — type a response anyway and SIGNAL will draft.)"}
        </div>
      </div>

      {/* User response */}
      <div>
        <EyebrowLabel>Your response</EyebrowLabel>
        <textarea
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          rows={4}
          placeholder="Type 2-4 sentences about your relevant experience…"
          className="w-full px-3 py-2 border border-neutral-300 rounded-signal-sm text-sm focus:outline-none focus:border-signal-accent"
        />
      </div>

      {/* Draft */}
      {hasDraft && !editMode && (
        <div>
          <EyebrowLabel>
            Suggested {isBullet ? "reframed bullet" : "new bullet/skill"}
          </EyebrowLabel>
          <div className="p-3 bg-signal-accent-soft border border-signal-accent/30 rounded-signal-sm text-sm text-neutral-900 whitespace-pre-wrap">
            {item.draft}
          </div>
          <button
            onClick={() => {
              setOverrideText(item.draft ?? "")
              setEditMode(true)
            }}
            className="mt-2 text-xs text-neutral-600 underline hover:text-neutral-900"
          >
            Edit before accepting
          </button>
        </div>
      )}

      {editMode && (
        <div>
          <EyebrowLabel>Edit draft</EyebrowLabel>
          <textarea
            value={overrideText}
            onChange={(e) => setOverrideText(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 border border-neutral-300 rounded-signal-sm text-sm focus:outline-none focus:border-signal-accent"
          />
          <button
            onClick={() => {
              setEditMode(false)
              setOverrideText("")
            }}
            className="mt-2 text-xs text-neutral-600 underline hover:text-neutral-900"
          >
            Cancel edit (use original draft)
          </button>
        </div>
      )}

      {/* Actions */}
      <div className="pt-4 border-t border-neutral-200">
        <div className="text-xs text-neutral-500 italic mb-3">
          {isBullet
            ? "Note: this decision will be final."
            : "After Accept, you'll pick how this lands in your resume."}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!hasDraft ? (
            <button
              onClick={onGenerate}
              disabled={isGenerating || !userInput.trim()}
              className="px-4 py-2 min-h-[44px] bg-signal-primary text-signal-primary-foreground text-sm font-bold rounded-signal-md hover:bg-signal-primary-hover disabled:opacity-50"
            >
              {isGenerating ? "Generating…" : "Generate draft"}
            </button>
          ) : (
            <>
              <button
                onClick={onAccept}
                disabled={isDeciding || isGenerating}
                className="px-4 py-2 min-h-[44px] bg-signal-primary text-signal-primary-foreground text-sm font-bold rounded-signal-md hover:bg-signal-primary-hover disabled:opacity-50"
              >
                {isDeciding
                  ? "Accepting…"
                  : isBullet
                    ? "Accept"
                    : "Accept and continue"}
              </button>
              <button
                onClick={onRegenerate}
                disabled={isDeciding || isGenerating}
                className="px-4 py-2 min-h-[44px] border border-neutral-300 text-neutral-700 text-sm font-semibold rounded-signal-md hover:bg-neutral-50 disabled:opacity-50"
              >
                {isGenerating ? "Regenerating…" : "Regenerate"}
              </button>
            </>
          )}
          <button
            onClick={onDecline}
            disabled={isDeciding || isGenerating}
            className="ml-auto px-4 py-2 min-h-[44px] text-neutral-600 text-sm font-semibold hover:text-neutral-900 disabled:opacity-50"
          >
            Decline
          </button>
          {!isBullet && (
            <button
              onClick={onSkip}
              disabled={isDeciding || isGenerating}
              className="px-4 py-2 min-h-[44px] text-neutral-600 text-sm font-semibold hover:text-neutral-900 disabled:opacity-50"
            >
              Skip (don&rsquo;t have this)
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Post-accept outcome picker for gap items. Renders the 4 buttons
 * locked in the design conversation, in the locked order:
 *
 *   1. Update an existing bullet with this   → bullet picker sub-step (D2)
 *   2. Add as a new bullet                    (add_new_bullet)
 *   3. Note for cover letter                  (note_for_cover_letter)
 *   4. This isn't something I've done         (acknowledge_genuine_gap)
 *
 * D1 stubbed button 1 with a "Coming soon" message. D2 wires button 1
 * through onPickUpdateExisting to the BulletPickerView sub-step. The
 * other three still fire /decide directly via onPick.
 *
 * Buttons stack vertically on all viewports (predictable mobile layout +
 * each button has a description; horizontal would crowd at 375px). Each
 * button is ≥ 64px tall (well above the 44px touch-target floor).
 */
function GapOutcomePicker({
  pendingFinalText,
  onPick,
  onPickUpdateExisting,
  onCancel,
  actionInFlight,
}: {
  pendingFinalText: string
  onPick: (outcome: GapPickerOutcome) => void
  /** D2: triggers the bullet picker sub-step (renders BulletPickerView in the parent). */
  onPickUpdateExisting: () => void
  onCancel: () => void
  actionInFlight: "generate" | "decide" | null
}) {
  const isDeciding = actionInFlight === "decide"

  const baseBtnClasses =
    "w-full text-left p-4 min-h-[64px] border rounded-signal-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
  const enabledBtnClasses =
    "border-neutral-200 bg-white hover:border-signal-accent hover:bg-signal-accent-soft"

  return (
    <div className="space-y-6">
      {/* What the user accepted, surfaced in the accent palette so it
       *  reads as "your selection." */}
      <div>
        <EyebrowLabel>You accepted</EyebrowLabel>
        <div className="p-4 bg-signal-accent-soft border border-signal-accent/30 rounded-signal-md text-sm text-neutral-900 whitespace-pre-wrap">
          {pendingFinalText}
        </div>
      </div>

      {/* Picker */}
      <div>
        <EyebrowLabel className="mb-3">
          How should this land in your resume?
        </EyebrowLabel>
        <div className="space-y-3">
          {/* 1. Update existing bullet — D2 wired (was D1 STUB). */}
          <button
            onClick={onPickUpdateExisting}
            disabled={isDeciding}
            className={`${baseBtnClasses} ${enabledBtnClasses}`}
          >
            <div className="font-bold text-sm text-neutral-900">
              Update an existing bullet with this
            </div>
            <div className="text-xs text-neutral-500 mt-1">
              We&rsquo;ll help you pick which bullet to rewrite.
            </div>
          </button>

          {/* 2. Add as a new bullet */}
          <button
            onClick={() => onPick("add_new_bullet")}
            disabled={isDeciding}
            className={`${baseBtnClasses} ${enabledBtnClasses}`}
          >
            <div className="font-bold text-sm text-neutral-900">
              Add as a new bullet
            </div>
            <div className="text-xs text-neutral-500 mt-1">
              We&rsquo;ll insert this as a new bullet in your resume.
            </div>
          </button>

          {/* 3. Note for cover letter */}
          <button
            onClick={() => onPick("note_for_cover_letter")}
            disabled={isDeciding}
            className={`${baseBtnClasses} ${enabledBtnClasses}`}
          >
            <div className="font-bold text-sm text-neutral-900">
              Note for cover letter
            </div>
            <div className="text-xs text-neutral-500 mt-1">
              Save this for your cover letter — won&rsquo;t change your resume.
            </div>
          </button>

          {/* 4. Acknowledge genuine gap */}
          <button
            onClick={() => onPick("acknowledge_genuine_gap")}
            disabled={isDeciding}
            className={`${baseBtnClasses} ${enabledBtnClasses}`}
          >
            <div className="font-bold text-sm text-neutral-900">
              This isn&rsquo;t something I&rsquo;ve done
            </div>
            <div className="text-xs text-neutral-500 mt-1">
              Honest acknowledgment — won&rsquo;t change your resume.
            </div>
          </button>
        </div>
      </div>

      {/* Back */}
      <div className="pt-4 border-t border-neutral-200">
        <button
          onClick={onCancel}
          disabled={isDeciding}
          className="text-sm text-neutral-600 hover:text-neutral-900 disabled:opacity-50"
        >
          ← Back to edit
        </button>
      </div>
    </div>
  )
}

function ManualEntryView({
  overrideText,
  setOverrideText,
  onAccept,
  onCancel,
  actionInFlight,
  itemType,
}: {
  overrideText: string
  setOverrideText: (s: string) => void
  onAccept: () => void
  onCancel: () => void
  actionInFlight: "generate" | "decide" | null
  itemType: "headline" | "bullet" | "gap"
}) {
  const isDeciding = actionInFlight === "decide"
  // For gap items the manual-entry Accept routes through the 4-button
  // picker (handleAccept stashes the text + flips gapOutcomeStep). The
  // button copy reflects this — "Accept and continue" → picker.
  const acceptCopy =
    itemType === "gap" ? "Accept and continue" : "Accept manual entry"
  return (
    <div className="space-y-4">
      <div className="p-3 bg-amber-50 border border-amber-200 rounded-signal-sm text-sm text-amber-900">
        We couldn&rsquo;t draft something grounded in what you&rsquo;ve shared.
        Try writing your own — you know your experience best.
      </div>
      <div>
        <EyebrowLabel>Your content (manual entry)</EyebrowLabel>
        <textarea
          value={overrideText}
          onChange={(e) => setOverrideText(e.target.value)}
          rows={4}
          placeholder="Type the final content here…"
          className="w-full px-3 py-2 border border-neutral-300 rounded-signal-sm text-sm focus:outline-none focus:border-signal-accent"
        />
      </div>
      <div className="pt-4 border-t border-neutral-200">
        <div className="text-xs text-neutral-500 italic mb-3">
          {itemType === "gap"
            ? "After Accept, you'll pick how this lands in your resume."
            : "Note: this decision will be final."}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onAccept}
            disabled={isDeciding || !overrideText.trim()}
            className="px-4 py-2 min-h-[44px] bg-signal-primary text-signal-primary-foreground text-sm font-bold rounded-signal-md hover:bg-signal-primary-hover disabled:opacity-50"
          >
            {isDeciding ? "Accepting…" : acceptCopy}
          </button>
          <button
            onClick={onCancel}
            disabled={isDeciding}
            className="px-4 py-2 min-h-[44px] text-neutral-600 text-sm font-semibold hover:text-neutral-900 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * D2: bullet picker sub-step. Surfaces the AI-suggested top-3 reword
 * candidates from item.suggested_bullets_for_reword (populated at
 * populator time by A3), with a "Show all bullets" expansion that
 * reveals every other selectable bullet in the resume.
 *
 * Layout:
 *
 *   You accepted: <pendingFinalText>            ← accent-soft callout
 *
 *   PICK A BULLET TO UPDATE
 *   Which existing bullet should this update?
 *
 *   OUR SUGGESTIONS  (if top-3 present)
 *   [radio]  Bullet text
 *            — Section Name                       ← muted, title-cased
 *   [radio]  Bullet text — Section Name
 *   [radio]  Bullet text — Section Name
 *
 *   Show all bullets ▾                             ← expansion link
 *     (on expand:)
 *   ALL RESUME BULLETS  (full list excluding the top-3 already shown)
 *   [radio]  ...
 *
 *   [Update this bullet]   ← primary CTA, disabled until selection
 *   ← Back to outcomes
 *
 * Empty-state handling:
 *   - suggestedBullets.length === 0 AND allResumeBullets.length === 0:
 *     "This resume has no bullets to update — pick a different
 *      outcome." + Back link only (no list, no CTA).
 *   - suggestedBullets.length === 0 AND allResumeBullets.length > 0:
 *     Skip the suggestions section, show "We couldn't find existing
 *      bullets that match this gap — pick any bullet below to update."
 *     + the full list expanded by default.
 *
 * Verbatim invariant: the bullet text passed to onSelect is the
 * VERBATIM resume line (preserved by extractAllResumeBullets). Display
 * may trim for readability but the onSelect payload is untouched —
 * resumeComposer's locate-and-replace needs character-for-character
 * match (C1 verbatim invariant, FRD §6.10).
 */
function BulletPickerView({
  pendingFinalText,
  suggestedBullets,
  allResumeBullets,
  onSelect,
  onBack,
  actionInFlight,
}: {
  pendingFinalText: string
  /** A3's verbatim resume substrings — top 3 candidates by Claude judgment. */
  suggestedBullets: string[]
  /** Every selectable bullet in the resume, with section context. */
  allResumeBullets: ResumeBulletWithSection[]
  /** Fires /decide with reword_existing_bullet + target_bullet_text. */
  onSelect: (bulletText: string) => void
  /** Back to GapOutcomePicker without firing /decide. */
  onBack: () => void
  actionInFlight: "generate" | "decide" | null
}) {
  const isDeciding = actionInFlight === "decide"
  const [selectedBulletText, setSelectedBulletText] = useState<string | null>(
    null,
  )
  const [showAllBullets, setShowAllBullets] = useState(false)

  // Bullets to render under the "All bullets" expansion. Exclude any
  // that are already in suggestedBullets (verbatim match) so the user
  // doesn't see the same bullet twice. Section context is preserved.
  const additionalBullets = useMemo(
    () =>
      allResumeBullets.filter(
        (b) => !suggestedBullets.includes(b.text),
      ),
    [allResumeBullets, suggestedBullets],
  )

  // For "OUR SUGGESTIONS", map A3's verbatim strings back to {text,
  // section} pairs by looking them up in allResumeBullets. A3's
  // suggestions ARE verbatim substrings of the resume so this lookup
  // succeeds whenever the resume has bullets the parser detected. If a
  // suggestion isn't found (rare — would mean A3 returned a string
  // outside what extractAllResumeBullets considers "selectable"), we
  // still render it with section="" so the user can pick it.
  const suggestedWithSection = useMemo(
    () =>
      suggestedBullets.map((text) => {
        const match = allResumeBullets.find((b) => b.text === text)
        return { text, section: match?.section ?? "" }
      }),
    [suggestedBullets, allResumeBullets],
  )

  const hasAnyBullets =
    suggestedBullets.length > 0 || allResumeBullets.length > 0

  // No bullets in the resume at all — empty-state path.
  if (!hasAnyBullets) {
    return (
      <div className="space-y-6">
        <div>
          <EyebrowLabel>You accepted</EyebrowLabel>
          <div className="p-4 bg-signal-accent-soft border border-signal-accent/30 rounded-signal-md text-sm text-neutral-900 whitespace-pre-wrap">
            {pendingFinalText}
          </div>
        </div>
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-signal-sm text-sm text-amber-900">
          This resume has no bullets to update — pick a different outcome.
        </div>
        <div className="pt-4 border-t border-neutral-200">
          <button
            onClick={onBack}
            disabled={isDeciding}
            className="text-sm text-neutral-600 hover:text-neutral-900 disabled:opacity-50"
          >
            ← Back to outcomes
          </button>
        </div>
      </div>
    )
  }

  // No AI suggestions but resume has bullets — empty-suggestions path.
  // Expand "all bullets" by default so the user isn't stuck behind a link.
  const noAiSuggestions = suggestedBullets.length === 0
  const allListExpanded = showAllBullets || noAiSuggestions

  return (
    <div className="space-y-6">
      {/* You accepted */}
      <div>
        <EyebrowLabel>You accepted</EyebrowLabel>
        <div className="p-4 bg-signal-accent-soft border border-signal-accent/30 rounded-signal-md text-sm text-neutral-900 whitespace-pre-wrap">
          {pendingFinalText}
        </div>
      </div>

      {/* Heading */}
      <div>
        <EyebrowLabel>Pick a bullet to update</EyebrowLabel>
        <p className="text-sm text-neutral-900">
          Which existing bullet should this update?
        </p>
      </div>

      {/* Empty-AI-suggestions explanation */}
      {noAiSuggestions && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-signal-sm text-sm text-amber-900">
          We couldn&rsquo;t find existing bullets that match this gap — pick
          any bullet below to update.
        </div>
      )}

      {/* Suggestions */}
      {suggestedBullets.length > 0 && (
        <div>
          <EyebrowLabel className="mb-2">Our suggestions</EyebrowLabel>
          <div className="space-y-2">
            {suggestedWithSection.map((b, idx) => (
              <BulletRadioCard
                key={`sug-${idx}`}
                bullet={b}
                selected={selectedBulletText === b.text}
                onSelect={() => setSelectedBulletText(b.text)}
                disabled={isDeciding}
              />
            ))}
          </div>
        </div>
      )}

      {/* Show-all toggle (hidden when noAiSuggestions because we
       *  auto-expand). */}
      {!noAiSuggestions && additionalBullets.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowAllBullets((v) => !v)}
            disabled={isDeciding}
            className="text-sm font-semibold text-signal-accent-foreground hover:underline disabled:opacity-50"
          >
            {showAllBullets ? "Hide additional bullets ▴" : "Show all bullets ▾"}
          </button>
        </div>
      )}

      {/* Additional bullets */}
      {allListExpanded && additionalBullets.length > 0 && (
        <div>
          <EyebrowLabel className="mb-2">
            {noAiSuggestions ? "All resume bullets" : "Other bullets"}
          </EyebrowLabel>
          <div className="space-y-2">
            {additionalBullets.map((b, idx) => (
              <BulletRadioCard
                key={`all-${idx}`}
                bullet={b}
                selected={selectedBulletText === b.text}
                onSelect={() => setSelectedBulletText(b.text)}
                disabled={isDeciding}
              />
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="pt-4 border-t border-neutral-200">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              if (selectedBulletText !== null) onSelect(selectedBulletText)
            }}
            disabled={isDeciding || selectedBulletText === null}
            className="px-4 py-2 min-h-[44px] bg-signal-primary text-signal-primary-foreground text-sm font-bold rounded-signal-md hover:bg-signal-primary-hover disabled:opacity-50"
          >
            {isDeciding ? "Updating…" : "Update this bullet"}
          </button>
          <button
            onClick={onBack}
            disabled={isDeciding}
            className="ml-auto text-sm text-neutral-600 hover:text-neutral-900 disabled:opacity-50"
          >
            ← Back to outcomes
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * D2: single bullet row in the picker. Shows the bullet text + section
 * annotation. Selection state styled via D1's selected-card pattern
 * (signal-accent border + signal-accent-soft background). Section
 * annotation uses em-dash + title-cased section name + muted text per
 * the design lock.
 */
function BulletRadioCard({
  bullet,
  selected,
  onSelect,
  disabled,
}: {
  bullet: ResumeBulletWithSection
  selected: boolean
  onSelect: () => void
  disabled: boolean
}) {
  return (
    <label
      className={`block p-3 min-h-[64px] rounded-signal-md border cursor-pointer transition-colors ${
        selected
          ? "border-signal-accent bg-signal-accent-soft"
          : "border-neutral-200 hover:border-signal-accent hover:bg-signal-accent-soft/40"
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <input
        type="radio"
        name="bullet-picker"
        checked={selected}
        onChange={onSelect}
        disabled={disabled}
        className="sr-only"
      />
      <div className="flex items-start gap-3">
        <span
          className={`mt-1 inline-block w-4 h-4 rounded-full border flex-shrink-0 ${
            selected ? "border-signal-accent bg-signal-accent" : "border-neutral-400"
          }`}
          aria-hidden="true"
        >
          {selected && (
            <span className="block w-2 h-2 rounded-full bg-white m-auto mt-1" />
          )}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-neutral-900 whitespace-pre-wrap break-words">
            {bullet.text.trim()}
          </div>
          {bullet.section && (
            <div className="text-xs text-neutral-500 mt-1">
              — {bullet.section}
            </div>
          )}
        </div>
      </div>
    </label>
  )
}
