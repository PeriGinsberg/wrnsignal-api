// app/positioning/phase2/[id]/items/[itemId]/page.tsx
//
// Phase 2 item detail screen — the per-item workflow surface.
// Handles all three interaction patterns:
//   - Pattern A (headline): auto-generate 1-3 options on first paint;
//     user picks radio or types override; accept/decline/regenerate.
//   - Pattern B (bullet): user types response to question, generates
//     draft, then accept/edit/regenerate/decline. No skip — a bullet
//     always exists in the resume; it can be rewritten or declined,
//     not skipped (per FRD §5.3 semantic distinction).
//   - Pattern C (gap): same flow as Pattern B + Skip button (per FRD
//     §5.3: skip = user doesn't have this experience).
//   - Manual-entry mode: triggered on /draft 422 grounding failure;
//     user types final_text directly, bypasses validation.
//
// FRD: docs/Features/positioning-phase2-frd.md §5.3 section workflow

"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  apiCall,
  type Phase2RunResponse,
  type Phase2DraftResponse,
  type Phase2DecideResponse,
  type PhaseTwoItem,
} from "@/lib/positioning-prototype"

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
      if (found.type === "bullet" || found.type === "gap") {
        setUserInput(found.user_response ?? "")
      }
      setViewState("loaded")
    }
    load()
  }, [params])

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
    setActionInFlight("decide")
    setActionError("")

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
      // Pattern B/C
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
    return <div className="p-8 text-neutral-500 text-sm">Loading item…</div>
  }

  if (viewState === "error") {
    return (
      <div className="p-8 max-w-2xl">
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
  const patternLabel =
    item.type === "headline"
      ? "Headline (Pattern A)"
      : item.type === "bullet"
        ? "Bullet (Pattern B)"
        : "Gap (Pattern C)"

  return (
    <div className="p-8 max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <a
          href={`/positioning/phase2/${phase2RunId}`}
          className="text-sm text-neutral-500 hover:text-neutral-900"
        >
          ← Back to selection
        </a>
        <h1 className="mt-3 text-xl font-semibold text-neutral-900">
          {item.label}
        </h1>
        <div className="mt-1 text-xs uppercase tracking-wide text-neutral-500">
          {patternLabel}
        </div>
      </div>

      {/* Body — branch on state */}
      {isDecided ? (
        <DecidedView item={item} />
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
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
          {actionError}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Subcomponents
// ============================================================================

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
      <div className={`p-3 rounded border ${decisionColor} text-sm`}>
        This item was <strong>{decisionKind.toLowerCase()}</strong>
        {item.decided_at &&
          ` on ${new Date(item.decided_at).toLocaleString()}`}
        {item.manual_entry && " (manual entry)"}.
      </div>
      {item.accepted && item.final_text && (
        <div className="mt-4">
          <div className="text-xs uppercase tracking-wide text-neutral-500 mb-1">
            Final content
          </div>
          <div className="p-3 bg-neutral-50 border border-neutral-200 rounded text-sm text-neutral-900 whitespace-pre-wrap">
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
      {/* Original */}
      <div>
        <div className="text-xs uppercase tracking-wide text-neutral-500 mb-1">
          Current headline
        </div>
        <div className="p-3 bg-neutral-50 border border-neutral-200 rounded text-sm text-neutral-900">
          {item.original}
        </div>
      </div>

      {/* Draft options */}
      <div>
        <div className="text-xs uppercase tracking-wide text-neutral-500 mb-2">
          Suggested reframes
        </div>
        {isGenerating && item.draft_options.length === 0 ? (
          <div className="text-sm text-neutral-500 italic">
            Generating options…
          </div>
        ) : (
          <div className="space-y-2">
            {item.draft_options.map((option, idx) => (
              <label
                key={idx}
                className={`block p-3 rounded border cursor-pointer transition-colors ${
                  selectedDraftIndex === idx
                    ? "border-neutral-900 bg-neutral-50"
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
        <div className="text-xs uppercase tracking-wide text-neutral-500 mb-1">
          Or write your own
        </div>
        <textarea
          value={overrideText}
          onChange={(e) => {
            setOverrideText(e.target.value)
            if (e.target.value.trim()) setSelectedDraftIndex(null)
          }}
          rows={2}
          placeholder="Type a custom headline…"
          className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:border-neutral-500"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-4 border-t border-neutral-200">
        <button
          onClick={onAccept}
          disabled={
            isDeciding ||
            isGenerating ||
            (selectedDraftIndex === null && !overrideText.trim())
          }
          className="px-4 py-2 bg-neutral-900 text-white text-sm font-medium rounded hover:bg-neutral-800 disabled:opacity-50"
        >
          {isDeciding ? "Accepting…" : "Accept"}
        </button>
        <button
          onClick={onRegenerate}
          disabled={isDeciding || isGenerating}
          className="px-4 py-2 border border-neutral-300 text-neutral-700 text-sm font-medium rounded hover:bg-neutral-50 disabled:opacity-50"
        >
          {isGenerating ? "Regenerating…" : "Regenerate"}
        </button>
        <button
          onClick={onDecline}
          disabled={isDeciding || isGenerating}
          className="ml-auto px-4 py-2 text-neutral-600 text-sm font-medium hover:text-neutral-900 disabled:opacity-50"
        >
          Decline
        </button>
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
        <div className="text-xs uppercase tracking-wide text-neutral-500 mb-1">
          {isBullet ? "Original bullet" : "Gap to address"}
        </div>
        <div className="p-3 bg-neutral-50 border border-neutral-200 rounded text-sm text-neutral-900">
          {isBullet
            ? (item as Extract<PhaseTwoItem, { type: "bullet" }>)
                .original_bullet
            : (item as Extract<PhaseTwoItem, { type: "gap" }>)
                .gap_description}
        </div>
      </div>

      <div>
        <div className="text-xs uppercase tracking-wide text-neutral-500 mb-1">
          Job description context
        </div>
        <div className="p-3 bg-neutral-50 border border-neutral-200 rounded text-sm text-neutral-900">
          {item.jd_context}
        </div>
      </div>

      {/* Question */}
      <div>
        <div className="text-xs uppercase tracking-wide text-neutral-500 mb-1">
          Question
        </div>
        <div className="text-sm text-neutral-900 italic">
          {item.question_asked ??
            "(Question not yet generated — populator stub in v0.1; type a response anyway and SIGNAL will draft.)"}
        </div>
      </div>

      {/* User response */}
      <div>
        <div className="text-xs uppercase tracking-wide text-neutral-500 mb-1">
          Your response
        </div>
        <textarea
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          rows={4}
          placeholder="Type 2-4 sentences about your relevant experience…"
          className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:border-neutral-500"
        />
      </div>

      {/* Draft */}
      {hasDraft && !editMode && (
        <div>
          <div className="text-xs uppercase tracking-wide text-neutral-500 mb-1">
            Suggested {isBullet ? "reframed bullet" : "new bullet/skill"}
          </div>
          <div className="p-3 bg-blue-50 border border-blue-200 rounded text-sm text-neutral-900 whitespace-pre-wrap">
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
          <div className="text-xs uppercase tracking-wide text-neutral-500 mb-1">
            Edit draft
          </div>
          <textarea
            value={overrideText}
            onChange={(e) => setOverrideText(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:border-neutral-500"
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
      <div className="flex items-center gap-2 pt-4 border-t border-neutral-200">
        {!hasDraft ? (
          <button
            onClick={onGenerate}
            disabled={isGenerating || !userInput.trim()}
            className="px-4 py-2 bg-neutral-900 text-white text-sm font-medium rounded hover:bg-neutral-800 disabled:opacity-50"
          >
            {isGenerating ? "Generating…" : "Generate draft"}
          </button>
        ) : (
          <>
            <button
              onClick={onAccept}
              disabled={isDeciding || isGenerating}
              className="px-4 py-2 bg-neutral-900 text-white text-sm font-medium rounded hover:bg-neutral-800 disabled:opacity-50"
            >
              {isDeciding ? "Accepting…" : "Accept"}
            </button>
            <button
              onClick={onRegenerate}
              disabled={isDeciding || isGenerating}
              className="px-4 py-2 border border-neutral-300 text-neutral-700 text-sm font-medium rounded hover:bg-neutral-50 disabled:opacity-50"
            >
              {isGenerating ? "Regenerating…" : "Regenerate"}
            </button>
          </>
        )}
        <button
          onClick={onDecline}
          disabled={isDeciding || isGenerating}
          className="ml-auto px-4 py-2 text-neutral-600 text-sm font-medium hover:text-neutral-900 disabled:opacity-50"
        >
          Decline
        </button>
        {!isBullet && (
          <button
            onClick={onSkip}
            disabled={isDeciding || isGenerating}
            className="px-4 py-2 text-neutral-600 text-sm font-medium hover:text-neutral-900 disabled:opacity-50"
          >
            Skip (don&rsquo;t have this)
          </button>
        )}
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
}: {
  overrideText: string
  setOverrideText: (s: string) => void
  onAccept: () => void
  onCancel: () => void
  actionInFlight: "generate" | "decide" | null
}) {
  const isDeciding = actionInFlight === "decide"
  return (
    <div className="space-y-4">
      <div className="p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-900">
        We couldn&rsquo;t draft something grounded in what you&rsquo;ve shared.
        Try writing your own — you know your experience best.
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-neutral-500 mb-1">
          Your content (manual entry)
        </div>
        <textarea
          value={overrideText}
          onChange={(e) => setOverrideText(e.target.value)}
          rows={4}
          placeholder="Type the final content here…"
          className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:border-neutral-500"
        />
      </div>
      <div className="flex items-center gap-2 pt-4 border-t border-neutral-200">
        <button
          onClick={onAccept}
          disabled={isDeciding || !overrideText.trim()}
          className="px-4 py-2 bg-neutral-900 text-white text-sm font-medium rounded hover:bg-neutral-800 disabled:opacity-50"
        >
          {isDeciding ? "Accepting…" : "Accept manual entry"}
        </button>
        <button
          onClick={onCancel}
          disabled={isDeciding}
          className="px-4 py-2 text-neutral-600 text-sm font-medium hover:text-neutral-900 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
