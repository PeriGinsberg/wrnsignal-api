// app/positioning/phase2/[id]/complete/page.tsx
//
// Phase 2 completion screen — final stop in the workflow prototype.
// Shows side-by-side preview of original vs. revised resume text, then
// asks the user whether to save the revised resume as a new persona
// before calling POST /api/positioning/v2/phase2/[id]/complete.
//
// FRD: docs/Features/positioning-phase2-frd.md §5.5 workflow completion +
//      §6.5.5 /complete endpoint
//
// D3 addition (v1 final commit): JobFit-category-aware coaching message
// renders above the resume diff. Conditional surface:
//   - Zero acknowledge_genuine_gap items OR no jobfit_decision context
//     → standard "resume ready" message (signal-accent-soft callout)
//   - Acknowledged gaps + Apply / Priority Apply → "your cover letter is
//     the right place to address these honestly" (signal-accent-soft)
//   - Acknowledged gaps + Review → "use your cover letter to demonstrate
//     self-awareness and learning trajectory" (amber caution)
//   - Acknowledged gaps + Pass → "JobFit did not recommend this role;
//     prepare carefully" (signal-primary stronger caution)
// Priority Apply merges with Apply for messaging — same coaching, no
// 4-way branching.
//
// Downstream gap (formally scoped to v0.2): the cover-letter generator
// at /api/coverletter does NOT currently consume note_for_cover_letter
// items from phase2_runs.state. The coaching message tells the user to
// "use your cover letter" but the automated cover-letter route doesn't
// see those notes yet. v0.2 runlog entry tracks the integration scope.

"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  apiCall,
  type Phase2RunResponse,
  type Phase2CompleteResponse,
} from "@/lib/positioning-prototype"

// Local type for /api/personas response (inline — only consumer in prototype)
type Persona = {
  id: string
  name: string
  resume_text: string
  is_default: boolean
  display_order: number
  persona_version: number
  created_at: string
  updated_at: string
}
type PersonasResponse = {
  ok: boolean
  personas: Persona[]
}

const MAX_PERSONA_NAME_LENGTH = 80

export default function Phase2CompletePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const router = useRouter()
  const [phase2RunId, setPhase2RunId] = useState("")

  // Fetch state
  const [viewState, setViewState] = useState<
    "loading" | "loaded" | "error" | "completed"
  >("loading")
  const [run, setRun] = useState<Phase2RunResponse | null>(null)
  const [persona, setPersona] = useState<Persona | null>(null)
  const [error, setError] = useState({ status: 0, message: "" })

  // Decision form state
  const [saveDecision, setSaveDecision] = useState<
    "save" | "use_only" | "stick_with_original" | null
  >(null)
  const [personaName, setPersonaName] = useState("")

  // Submission state
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<{
    code: string
    detail?: string
  } | null>(null)

  // Success state
  const [completedResult, setCompletedResult] =
    useState<Phase2CompleteResponse | null>(null)
  // The saveDecision that was active at the time of submission. Snapshotted
  // separately so CompletedView can branch on the 3-way semantic distinction
  // even though the API response only encodes 2-way (new_persona_id null/set).
  const [completedDecision, setCompletedDecision] = useState<
    "save" | "use_only" | "stick_with_original" | null
  >(null)

  // Avoid unused-router warning if subcomponents handle nav via <a>; router
  // remains available for future polish (e.g., confirmation prompts).
  void router

  // ──────────────────────────────────────────────────────────────────────
  // EFFECTS
  // ──────────────────────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      const { id } = await params
      setPhase2RunId(id)

      // Fetch run
      const runRes = await apiCall<Phase2RunResponse>(
        `/api/positioning/v2/phase2/${id}`,
      )
      if (!runRes.ok) {
        setError({
          status: runRes.status,
          message:
            runRes.error + (runRes.detail ? `: ${runRes.detail}` : ""),
        })
        setViewState("error")
        return
      }
      setRun(runRes.data)

      // Fetch personas to find the one this phase2_run is attached to.
      // We need persona.resume_text for the side-by-side "original" pane.
      // If the persona fetch fails (rare), we still render the page — the
      // original pane will show "(unavailable)".
      const personasRes = await apiCall<PersonasResponse>("/api/personas")
      if (personasRes.ok) {
        const found = personasRes.data.personas.find(
          (p) => p.id === runRes.data.persona_id,
        )
        if (found) setPersona(found)
      }

      setViewState("loaded")
    }
    load()
  }, [params])

  // ──────────────────────────────────────────────────────────────────────
  // ACTION HANDLERS
  // ──────────────────────────────────────────────────────────────────────

  async function handleComplete() {
    if (!run) return

    // Client-side validation
    if (saveDecision === null) {
      setSubmitError({
        code: "missing_decision",
        detail: "Choose whether to save as a new persona or discard.",
      })
      return
    }
    if (saveDecision === "save") {
      const trimmed = personaName.trim()
      if (!trimmed) {
        setSubmitError({ code: "persona_name_required" })
        return
      }
      if (trimmed.length > MAX_PERSONA_NAME_LENGTH) {
        setSubmitError({ code: "persona_name_too_long" })
        return
      }
    }

    setSubmitting(true)
    setSubmitError(null)

    const body =
      saveDecision === "save"
        ? { save_as_persona: true, persona_name: personaName.trim() }
        : { save_as_persona: false }

    const result = await apiCall<Phase2CompleteResponse>(
      `/api/positioning/v2/phase2/${run.phase2_run_id}/complete`,
      { method: "POST", body: JSON.stringify(body) },
    )

    if (!result.ok) {
      setSubmitError({ code: result.error, detail: result.detail })
      setSubmitting(false)
      // Special case: 409 means another tab/session already completed.
      // Reload run so user sees the already-finalized view next paint.
      if (result.status === 409) {
        const reload = await apiCall<Phase2RunResponse>(
          `/api/positioning/v2/phase2/${run.phase2_run_id}`,
        )
        if (reload.ok) setRun(reload.data)
      }
      return
    }

    setCompletedResult(result.data)
    setCompletedDecision(saveDecision)
    setViewState("completed")
  }

  // ──────────────────────────────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────────────────────────────

  if (viewState === "loading") {
    return <div className="p-8 text-neutral-500 text-sm">Loading…</div>
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

  if (viewState === "completed" && completedResult) {
    return (
      <CompletedView
        result={completedResult}
        decision={completedDecision}
      />
    )
  }

  if (!run) return null

  // Already-finalized view: phase2_run.status was already !in_progress on load
  if (run.status !== "in_progress") {
    return <AlreadyFinalizedView run={run} />
  }

  const originalText = persona?.resume_text ?? "(original resume unavailable)"
  const revisedText =
    run.revised_resume_text ??
    persona?.resume_text ??
    "(no revisions yet)"

  // D3: count accepted gap items with acknowledge_genuine_gap outcome.
  // Drives the category-aware coaching message above the resume diff.
  // Acknowledge-genuine-gap is the user's honest "I haven't done this"
  // signal — surfacing it as coaching helps users make intentional
  // cover-letter + interview preparation decisions.
  const acknowledgedGapsCount = run.state.items.filter(
    (i) =>
      i.type === "gap" &&
      i.accepted === true &&
      i.compositional_outcome === "acknowledge_genuine_gap",
  ).length

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <a
          href={`/positioning/phase2/${phase2RunId}`}
          className="text-sm text-neutral-500 hover:text-neutral-900"
        >
          ← Back to selection
        </a>
        <h1 className="mt-3 text-2xl font-semibold text-neutral-900">
          Complete Your Reframing
        </h1>
        <p className="mt-1 text-sm text-neutral-600">
          Review the changes below and decide whether to save them as a new
          persona.
        </p>
      </div>

      {/* D3: category-aware coaching message. Renders ABOVE the resume
       *  diff per design lock. Branches on acknowledged_gaps_count +
       *  jobfit_decision. Zero acknowledged gaps → standard "resume ready"
       *  message. See CompletionMessage JSDoc for the category matrix. */}
      <CompletionMessage
        acknowledgedGapsCount={acknowledgedGapsCount}
        jobfitDecision={run.jobfit_decision}
      />

      {/* v0.1 export-format notice — narrowed in D3 from the B4 banner
       *  which mentioned cover-letter notes + acknowledged-gap side panel.
       *  Acknowledged gaps now surface via CompletionMessage above; cover
       *  letter notes flow downstream (v0.2 integration tracked in
       *  runlog). Only export-format constraint remains. */}
      <div className="mb-6 p-3 bg-amber-50 border border-amber-200 rounded-signal-sm text-sm text-amber-900">
        <strong>v0.1 note:</strong> .docx/.pdf export will come later — for
        now, use Copy to grab the revised text.
      </div>

      {/* Side-by-side preview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        <ResumePane label="Original" text={originalText} />
        <ResumePane label="Revised" text={revisedText} accent />
      </div>

      {/* Decision section */}
      <div className="mb-6 p-5 border border-neutral-200 rounded">
        <h2 className="text-sm font-semibold text-neutral-900 mb-3">
          What should happen to the revised resume?
        </h2>

        <div className="space-y-2">
          <label
            className={`flex items-start gap-2 p-3 rounded border cursor-pointer transition-colors ${
              saveDecision === "save"
                ? "border-neutral-900 bg-neutral-50"
                : "border-neutral-200 hover:border-neutral-400"
            }`}
          >
            <input
              type="radio"
              name="save_decision"
              checked={saveDecision === "save"}
              onChange={() => setSaveDecision("save")}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-neutral-900">
                Save as a new persona
              </div>
              <div className="text-xs text-neutral-500 mt-0.5">
                Adds the revised resume to your persona library. Use it for
                future JobFit runs on similar roles.
              </div>
            </div>
          </label>

          <label
            className={`flex items-start gap-2 p-3 rounded border cursor-pointer transition-colors ${
              saveDecision === "use_only"
                ? "border-neutral-900 bg-neutral-50"
                : "border-neutral-200 hover:border-neutral-400"
            }`}
          >
            <input
              type="radio"
              name="save_decision"
              checked={saveDecision === "use_only"}
              onChange={() => setSaveDecision("use_only")}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-neutral-900">
                Use for this job only
              </div>
              <div className="text-xs text-neutral-500 mt-0.5">
                Finalizes this workflow. The revised text stays accessible on
                this run; it just won&rsquo;t become a reusable persona.
              </div>
            </div>
          </label>

          <label
            className={`flex items-start gap-2 p-3 rounded border cursor-pointer transition-colors ${
              saveDecision === "stick_with_original"
                ? "border-neutral-900 bg-neutral-50"
                : "border-neutral-200 hover:border-neutral-400"
            }`}
          >
            <input
              type="radio"
              name="save_decision"
              checked={saveDecision === "stick_with_original"}
              onChange={() => setSaveDecision("stick_with_original")}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-neutral-900">
                Stick with my original resume
              </div>
              <div className="text-xs text-neutral-500 mt-0.5">
                You went through the workflow but want to keep your original.
                The revised text won&rsquo;t be saved or used.
              </div>
            </div>
          </label>
        </div>

        {/* Persona name input — shown only when Save selected */}
        {saveDecision === "save" && (
          <div className="mt-4 pt-4 border-t border-neutral-200">
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-neutral-700">
                Persona name
              </label>
              <span
                className={`text-xs font-mono ${
                  personaName.length > MAX_PERSONA_NAME_LENGTH
                    ? "text-red-600"
                    : "text-neutral-400"
                }`}
              >
                {personaName.length} / {MAX_PERSONA_NAME_LENGTH}
              </span>
            </div>
            <input
              type="text"
              value={personaName}
              onChange={(e) => setPersonaName(e.target.value)}
              placeholder="Catherine — Marketing Coordinator (for Diligent)"
              className={`w-full px-3 py-2 border rounded text-sm focus:outline-none ${
                personaName.length > MAX_PERSONA_NAME_LENGTH
                  ? "border-red-500 focus:border-red-600"
                  : "border-neutral-300 focus:border-neutral-500"
              }`}
            />
            <p className="text-xs text-neutral-500 mt-1">
              Max {MAX_PERSONA_NAME_LENGTH} characters. Tip: include the role
              and company so it&rsquo;s easy to identify later.
            </p>
          </div>
        )}
      </div>

      {/* Submit error */}
      {submitError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
          <strong>{formatErrorTitle(submitError.code)}</strong>
          <p className="mt-1">{formatErrorMessage(submitError)}</p>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-3 pt-4 border-t border-neutral-200">
        <button
          onClick={handleComplete}
          disabled={submitting || saveDecision === null}
          className="px-4 py-2 bg-neutral-900 text-white text-sm font-medium rounded hover:bg-neutral-800 disabled:opacity-50"
        >
          {submitting ? "Completing…" : "Complete workflow"}
        </button>
        <a
          href={`/positioning/phase2/${phase2RunId}`}
          className="px-4 py-2 text-neutral-600 text-sm font-medium hover:text-neutral-900"
        >
          Cancel
        </a>
      </div>
    </div>
  )
}

// ============================================================================
// Subcomponents
// ============================================================================

/**
 * D3: JobFit-category-aware coaching message rendered above the resume
 * diff on /complete. The architectural pivot vs. the original D3 plan:
 * we don't LIST cover-letter notes or acknowledged gaps (cover-letter
 * notes flow downstream — currently to nowhere, but v0.2 wires them
 * into /api/coverletter; acknowledged gaps the user already decided
 * don't need resurfacing). Instead we surface a single category-aware
 * coaching message that helps users prep for cover-letter writing +
 * interview readiness based on:
 *
 *   - whether they have any acknowledge_genuine_gap items, AND
 *   - the JobFit recommendation category (Apply / Review / Pass)
 *
 * Priority Apply merges with Apply — same coaching, no 4-way branching.
 *
 * Category matrix:
 *
 *   Zero acknowledged | any category | (signal-accent-soft, neutral)
 *     → "Your revised resume is ready."
 *
 *   ≥1 acknowledged   | Apply / Priority Apply | (signal-accent-soft)
 *     → "You acknowledged N gap(s) — your cover letter is the right
 *        place to address these honestly."
 *
 *   ≥1 acknowledged   | Review | (amber caution)
 *     → "This role was a 'Review' fit. Your acknowledged gap(s) will
 *        likely come up in interviews. Use your cover letter to
 *        demonstrate self-awareness and learning trajectory."
 *
 *   ≥1 acknowledged   | Pass | (signal-primary stronger caution)
 *     → "JobFit recommended this role wasn't a strong fit. You've
 *        decided to apply anyway. The N gap(s) you acknowledged may
 *        be material to interview outcomes. Prepare your cover letter
 *        and interview responses carefully."
 *
 *   ≥1 acknowledged   | null (lookup miss) | (signal-accent-soft)
 *     → Falls back to "resume ready" copy. No category context to
 *        condition coaching on.
 */
function CompletionMessage({
  acknowledgedGapsCount,
  jobfitDecision,
}: {
  acknowledgedGapsCount: number
  jobfitDecision: "Priority Apply" | "Apply" | "Review" | "Pass" | null
}) {
  // Zero acknowledged → standard "resume ready" message regardless of
  // category. Also the fallback path when jobfit_decision is null.
  if (acknowledgedGapsCount === 0 || jobfitDecision === null) {
    return (
      <div className="mb-6 p-4 bg-signal-accent-soft border border-signal-accent/30 rounded-signal-md">
        <p className="text-sm text-neutral-900">
          Your revised resume is ready. Review the changes below and decide
          whether to save them as a new persona.
        </p>
      </div>
    )
  }

  const n = acknowledgedGapsCount
  const gapPhrase = n === 1 ? "1 gap" : `${n} gaps`

  // Priority Apply merges with Apply — same coaching, no separate branch.
  const isApplyish = jobfitDecision === "Apply" || jobfitDecision === "Priority Apply"

  if (isApplyish) {
    return (
      <div className="mb-6 p-4 bg-signal-accent-soft border border-signal-accent/30 rounded-signal-md">
        <div className="text-[11px] uppercase tracking-[0.12em] text-signal-accent-foreground font-semibold mb-1">
          Your revised resume is ready
        </div>
        <p className="text-sm text-neutral-900">
          You acknowledged {gapPhrase} — your cover letter is the right place
          to address {n === 1 ? "this" : "these"} honestly.
        </p>
      </div>
    )
  }

  if (jobfitDecision === "Review") {
    return (
      <div className="mb-6 p-4 bg-amber-50 border border-amber-300 rounded-signal-md">
        <div className="text-[11px] uppercase tracking-[0.12em] text-amber-900 font-semibold mb-1">
          &ldquo;Review&rdquo; fit — prepare your cover letter carefully
        </div>
        <p className="text-sm text-amber-900">
          This role was a &ldquo;Review&rdquo; fit. Your acknowledged{" "}
          {n === 1 ? "gap" : "gaps"} will likely come up in interviews. Use
          your cover letter to demonstrate self-awareness and learning
          trajectory.
        </p>
      </div>
    )
  }

  // Pass — strongest caution. signal-primary tint.
  return (
    <div className="mb-6 p-4 bg-signal-primary/15 border border-signal-primary/40 rounded-signal-md">
      <div className="text-[11px] uppercase tracking-[0.12em] text-signal-primary-foreground font-semibold mb-1">
        JobFit did not recommend this role
      </div>
      <p className="text-sm text-neutral-900">
        JobFit recommended this role wasn&rsquo;t a strong fit. You&rsquo;ve
        decided to apply anyway. The {gapPhrase} you acknowledged may be
        material to interview outcomes. Prepare your cover letter and
        interview responses carefully.
      </p>
    </div>
  )
}

function ResumePane({
  label,
  text,
  accent = false,
}: {
  label: string
  text: string
  accent?: boolean
}) {
  return (
    <div className="border border-neutral-200 rounded overflow-hidden flex flex-col">
      <div
        className={`px-3 py-2 text-xs uppercase tracking-wide font-medium border-b border-neutral-200 ${
          accent ? "bg-blue-50 text-blue-700" : "bg-neutral-50 text-neutral-700"
        }`}
      >
        {label}
      </div>
      <div className="p-3 font-mono text-xs text-neutral-900 whitespace-pre-wrap max-h-[480px] overflow-y-auto">
        {text}
      </div>
    </div>
  )
}

function CompletedView({
  result,
  decision,
}: {
  result: Phase2CompleteResponse
  decision: "save" | "use_only" | "stick_with_original" | null
}) {
  // Branch on decision for body + copy-button prominence + revised text display
  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="p-6 bg-green-50 border border-green-200 rounded">
        <h1 className="text-xl font-semibold text-green-900">
          Workflow completed!
        </h1>
        <p className="mt-2 text-sm text-green-800">
          {decision === "save" && result.new_persona_id && (
            <>
              Saved as a new persona{" "}
              <code className="bg-white px-1.5 py-0.5 rounded text-xs">
                {result.new_persona_id.slice(0, 8)}…
              </code>
              . You can use it in future JobFit runs from{" "}
              <a href="/dashboard" className="underline">
                /dashboard
              </a>
              .
            </>
          )}
          {decision === "use_only" &&
            "Here's your revised resume. Copy it to use for your application."}
          {decision === "stick_with_original" &&
            "You chose to keep your original resume. The revised text wasn't saved or applied."}
          {decision === null && "Workflow finalized."}
        </p>
      </div>

      {/* Option 1 (save) — copy button + collapsible */}
      {decision === "save" && (
        <>
          <div className="mt-6">
            <CopyButton text={result.revised_resume_text} />
          </div>
          <div className="mt-4">
            <details className="text-sm text-neutral-600">
              <summary className="cursor-pointer hover:text-neutral-900">
                View the final revised resume text
              </summary>
              <div className="mt-3 p-3 bg-neutral-50 border border-neutral-200 rounded font-mono text-xs text-neutral-900 whitespace-pre-wrap max-h-[480px] overflow-y-auto">
                {result.revised_resume_text}
              </div>
            </details>
          </div>
        </>
      )}

      {/* Option 2 (use_only) — prominent copy + expanded text */}
      {decision === "use_only" && (
        <>
          <div className="mt-6">
            <CopyButton text={result.revised_resume_text} />
          </div>
          <div className="mt-4 p-3 bg-neutral-50 border border-neutral-200 rounded font-mono text-xs text-neutral-900 whitespace-pre-wrap max-h-[480px] overflow-y-auto">
            {result.revised_resume_text}
          </div>
        </>
      )}

      {/* Option 3 (stick_with_original) — small de-emphasized collapsible */}
      {decision === "stick_with_original" && (
        <div className="mt-6">
          <details className="text-xs text-neutral-500">
            <summary className="cursor-pointer hover:text-neutral-700">
              View the revised resume anyway
            </summary>
            <div className="mt-3 p-3 bg-neutral-50 border border-neutral-200 rounded font-mono text-xs text-neutral-700 whitespace-pre-wrap max-h-[480px] overflow-y-auto">
              {result.revised_resume_text}
            </div>
          </details>
        </div>
      )}

      <div className="mt-6 flex items-center gap-3">
        <a
          href="/dashboard"
          className="px-4 py-2 bg-neutral-900 text-white text-sm font-medium rounded hover:bg-neutral-800"
        >
          Back to Dashboard
        </a>
      </div>
    </div>
  )
}

function AlreadyFinalizedView({ run }: { run: Phase2RunResponse }) {
  const revisedText = run.revised_resume_text ?? ""
  const hasText = revisedText.trim().length > 0

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="p-6 bg-neutral-50 border border-neutral-200 rounded">
        <h1 className="text-xl font-semibold text-neutral-900">
          This workflow is already {run.status === "completed" ? "completed" : "abandoned"}
        </h1>
        <p className="mt-2 text-sm text-neutral-700">
          {run.completed_at && (
            <>Finalized on {new Date(run.completed_at).toLocaleString()}.</>
          )}
        </p>
        {run.new_persona_id && (
          <p className="mt-2 text-sm text-neutral-700">
            Saved as persona{" "}
            <code className="bg-white px-1.5 py-0.5 rounded text-xs border border-neutral-200">
              {run.new_persona_id.slice(0, 8)}…
            </code>
          </p>
        )}
      </div>

      {/* Revised text + Copy button (always available for returning users
          who may need to grab the text after the fact). Doesn't reconstruct
          which of the 3 options the user originally picked — just shows
          what's on the row. */}
      {hasText && (
        <>
          <div className="mt-6">
            <CopyButton text={revisedText} />
          </div>
          <div className="mt-4 p-3 bg-neutral-50 border border-neutral-200 rounded font-mono text-xs text-neutral-900 whitespace-pre-wrap max-h-[480px] overflow-y-auto">
            {revisedText}
          </div>
        </>
      )}

      <div className="mt-6 flex items-center gap-3">
        <a
          href="/dashboard"
          className="px-4 py-2 bg-neutral-900 text-white text-sm font-medium rounded hover:bg-neutral-800"
        >
          Back to Dashboard
        </a>
        <a
          href={`/positioning/phase2/${run.phase2_run_id}`}
          className="text-sm text-neutral-600 hover:text-neutral-900"
        >
          View workflow (read-only)
        </a>
      </div>
    </div>
  )
}

function CopyButton({
  text,
  label = "Copy revised resume",
  prominent = true,
}: {
  text: string
  label?: string
  prominent?: boolean
}) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API can fail in non-secure contexts or older browsers.
      // For prototype, fail silently; user can still select+copy manually
      // from the visible text block.
    }
  }

  const baseClasses = prominent
    ? "px-4 py-2 bg-neutral-900 text-white text-sm font-medium rounded hover:bg-neutral-800"
    : "px-3 py-1.5 border border-neutral-300 text-neutral-700 text-xs font-medium rounded hover:bg-neutral-50"

  return (
    <button
      onClick={handleCopy}
      className={`${baseClasses} ${copied ? "bg-green-600 hover:bg-green-700" : ""}`}
    >
      {copied ? "Copied!" : label}
    </button>
  )
}

// ============================================================================
// Error mapping helpers
// ============================================================================

function formatErrorTitle(code: string): string {
  switch (code) {
    case "missing_decision":
      return "Pick an option"
    case "persona_name_required":
      return "Persona name required"
    case "persona_name_too_long":
      return "Persona name too long"
    case "no_changes_to_save":
      return "No changes to save"
    case "persona_cap_exceeded":
      return "Persona limit reached"
    case "phase2_run_already_finalized":
      return "Already finalized"
    case "phase2_run_not_found":
      return "Run not found"
    default:
      return "Error"
  }
}

function formatErrorMessage(err: { code: string; detail?: string }): string {
  switch (err.code) {
    case "missing_decision":
      return "Choose 'Save as a new persona' or 'Discard revisions' before completing."
    case "persona_name_required":
      return "Enter a name for your new persona, or choose 'Discard revisions'."
    case "persona_name_too_long":
      return `Persona name must be ${MAX_PERSONA_NAME_LENGTH} characters or fewer.`
    case "no_changes_to_save":
      return "You haven't accepted any items in this workflow. Either accept at least one recommendation on the selection screen, or pick 'Stick with my original resume' here."
    case "persona_cap_exceeded":
      return "You've reached the 10-persona limit. Delete a persona from /dashboard before saving this one, or pick 'Use for this job only' to keep the revised text for this application without saving as a persona."
    case "phase2_run_already_finalized":
      return "Another tab or session completed this workflow. Refresh the page to see the current state."
    case "phase2_run_not_found":
      return "This Phase 2 run no longer exists."
    default:
      return err.detail ?? "Unexpected error. Please try again."
  }
}
