// app/positioning/phase2/page.tsx
//
// Phase 2 bootstrap page — the missing entry point that turns a
// positioning_run_id into a phase2_run via POST /api/positioning/v2/
// phase2/start, then routes to the existing /positioning/phase2/[id]
// selection screen.
//
// Shipped after Stage 2b made populateItems return real items. The
// prototype's other pages (selection / item detail / completion) all
// assumed a phase2_run_id was already in hand — this page closes the
// gap so the demo is end-to-end clickable on staging without a manual
// curl bootstrap.
//
// Behavior:
//   - Default: text input for positioning_run_id (UUID) + Start button
//   - ?positioning_run_id=<uuid> URL param: prefill + auto-submit
//   - 200: route to /positioning/phase2/<phase2_run_id>
//   - 400 case_not_supported: error card explaining Case B-only support
//   - 400 persona_resume_text_empty: error card explaining the missing
//     resume requirement
//   - 409 in_progress_phase2_run_exists: "resume existing run" card with
//     a button routing to the existing phase2_run_id from response body
//   - Other errors: generic fallback card
//
// FRD: docs/Features/positioning-phase2-frd.md §6.5.1 (/start endpoint)

"use client"

import { Suspense, useCallback, useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  getToken,
  type Phase2StartResponse,
} from "@/lib/positioning-prototype"

// Basic UUID v4-ish shape check. The route validates strictly server-side;
// this is the cheap client-side gate so we don't fire malformed POSTs.
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Error envelope returned by /start on each failure path. The fields are
// per the route's withCorsJson body shape — see app/api/positioning/v2/
// phase2/start/route.ts.
type StartErrorState =
  | { kind: "case_not_supported"; detail?: string }
  | { kind: "persona_resume_text_empty"; detail?: string }
  | { kind: "in_progress_phase2_run_exists"; existingPhase2RunId: string }
  | { kind: "other"; status: number; code: string; detail?: string }

export default function Phase2BootstrapPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-neutral-500 text-sm">Loading…</div>
      }
    >
      <Phase2BootstrapInner />
    </Suspense>
  )
}

function Phase2BootstrapInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [inputValue, setInputValue] = useState("")
  const [validationError, setValidationError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [startError, setStartError] = useState<StartErrorState | null>(null)

  // Guard against double-firing the auto-submit when both useEffects fire
  // (StrictMode dev double-invocation; param change re-renders).
  const autoSubmittedRef = useRef(false)

  // ──────────────────────────────────────────────────────────────────────
  // Submit handler — single source of truth for both manual + auto submit
  // ──────────────────────────────────────────────────────────────────────

  const submit = useCallback(
    async (rawId: string) => {
      const id = rawId.trim()
      setValidationError("")
      setStartError(null)

      if (!id) {
        setValidationError("Enter a positioning_run_id to continue.")
        return
      }
      if (!UUID_RX.test(id)) {
        setValidationError("That doesn't look like a UUID. Format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx")
        return
      }

      setSubmitting(true)

      // Direct fetch (not apiCall) so we can read the full response body in
      // a single round-trip. The 409 case carries phase2_run_id alongside
      // the error code — apiCall's ApiResult envelope drops body fields
      // beyond error/detail, and a re-fetch to recover the id has a race
      // (the in-progress run could complete in between, silently creating
      // a new phase2_run on the retry).
      const token = await getToken()
      let res: Response
      try {
        res = await fetch("/api/positioning/v2/phase2/start", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ positioning_run_id: id }),
        })
      } catch (e) {
        setSubmitting(false)
        setStartError({
          kind: "other",
          status: 0,
          code: "network_error",
          detail: e instanceof Error ? e.message : "Network request failed",
        })
        return
      }

      let body: Record<string, unknown> = {}
      try {
        body = (await res.json()) as Record<string, unknown>
      } catch {
        // Non-JSON or empty body — fall through with empty body.
      }
      setSubmitting(false)

      if (res.ok) {
        const data = body as Partial<Phase2StartResponse>
        if (typeof data.phase2_run_id === "string") {
          router.push(`/positioning/phase2/${data.phase2_run_id}`)
          return
        }
        setStartError({
          kind: "other",
          status: res.status,
          code: "missing_phase2_run_id",
          detail: "Server returned 2xx without phase2_run_id.",
        })
        return
      }

      const errCode = typeof body.error === "string" ? body.error : `http_${res.status}`
      const detail = typeof body.detail === "string" ? body.detail : undefined

      // Failure branches — discriminated on the route's error code
      if (res.status === 400 && errCode === "case_not_supported") {
        setStartError({ kind: "case_not_supported", detail })
        return
      }
      if (res.status === 400 && errCode === "persona_resume_text_empty") {
        setStartError({ kind: "persona_resume_text_empty", detail })
        return
      }
      if (res.status === 409 && errCode === "in_progress_phase2_run_exists") {
        const existingId =
          typeof body.phase2_run_id === "string" ? body.phase2_run_id : null
        if (existingId) {
          setStartError({
            kind: "in_progress_phase2_run_exists",
            existingPhase2RunId: existingId,
          })
        } else {
          setStartError({
            kind: "other",
            status: 409,
            code: errCode,
            detail:
              "An in-progress run exists but its id was missing from the response body.",
          })
        }
        return
      }

      setStartError({
        kind: "other",
        status: res.status,
        code: errCode,
        detail,
      })
    },
    [router],
  )

  // ──────────────────────────────────────────────────────────────────────
  // Query-param shortcut — prefill + auto-submit if ?positioning_run_id=
  // ──────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const fromUrl = searchParams.get("positioning_run_id") ?? ""
    if (!fromUrl) return
    if (autoSubmittedRef.current) return
    autoSubmittedRef.current = true
    setInputValue(fromUrl)
    void submit(fromUrl)
  }, [searchParams, submit])

  // ──────────────────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────────────────

  // Error states take over the main pane when present.
  if (startError) {
    return (
      <StartErrorView
        state={startError}
        router={router}
        onTryAnother={() => {
          setStartError(null)
          setInputValue("")
          autoSubmittedRef.current = false
        }}
      />
    )
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-wide text-neutral-500">
          Phase 2 Bootstrap
        </p>
        <h1 className="text-2xl font-semibold text-neutral-900 mt-1">
          Start a Resume Reframing Workflow
        </h1>
        <p className="mt-2 text-sm text-neutral-600">
          Enter a <code className="bg-neutral-100 px-1 py-0.5 rounded text-xs">positioning_run_id</code> to
          create a new Phase 2 run. The id comes from a completed Phase 1
          run on the dashboard — copy it from the URL or from a recent
          positioning history entry.
        </p>
      </div>

      <div className="border border-neutral-200 rounded p-5">
        <label
          htmlFor="positioning-run-id"
          className="block text-xs uppercase tracking-wide text-neutral-500 mb-1"
        >
          Positioning run id
        </label>
        <input
          id="positioning-run-id"
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value)
            if (validationError) setValidationError("")
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !submitting) {
              void submit(inputValue)
            }
          }}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          disabled={submitting}
          className="w-full px-3 py-2 border border-neutral-300 rounded text-sm font-mono focus:outline-none focus:border-neutral-500 disabled:bg-neutral-50 disabled:text-neutral-500"
        />
        {validationError && (
          <p className="mt-2 text-xs text-red-700">{validationError}</p>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={() => void submit(inputValue)}
            disabled={submitting || !inputValue.trim()}
            className="px-4 py-2 bg-neutral-900 text-white text-sm font-medium rounded hover:bg-neutral-800 disabled:opacity-50"
          >
            {submitting ? "Starting…" : "Start Phase 2"}
          </button>
          <p className="text-xs text-neutral-500">
            Phase 2 supports Case B positioning_runs only.
          </p>
        </div>
      </div>

      <div className="mt-6 text-xs text-neutral-500">
        Tip: shareable link format —{" "}
        <code className="bg-neutral-100 px-1 py-0.5 rounded">
          /positioning/phase2?positioning_run_id=&lt;uuid&gt;
        </code>{" "}
        prefills and auto-submits.
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Error views
// ────────────────────────────────────────────────────────────────────────

function StartErrorView({
  state,
  router,
  onTryAnother,
}: {
  state: StartErrorState
  router: ReturnType<typeof useRouter>
  onTryAnother: () => void
}) {
  if (state.kind === "in_progress_phase2_run_exists") {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <p className="text-xs uppercase tracking-wide text-neutral-500">
          Phase 2 Bootstrap
        </p>
        <h1 className="text-2xl font-semibold text-neutral-900 mt-1">
          You already have an in-progress run
        </h1>
        <p className="mt-2 text-sm text-neutral-700">
          A Phase 2 run for this positioning_run is already in progress.
          Resume it where you left off, or start over from a different
          positioning_run.
        </p>
        <div className="mt-6 flex items-center gap-2">
          <button
            onClick={() =>
              router.push(`/positioning/phase2/${state.existingPhase2RunId}`)
            }
            className="px-4 py-2 bg-neutral-900 text-white text-sm font-medium rounded hover:bg-neutral-800"
          >
            Resume existing run →
          </button>
          <button
            onClick={onTryAnother}
            className="px-4 py-2 border border-neutral-300 text-neutral-700 text-sm font-medium rounded hover:bg-neutral-50"
          >
            Try a different positioning_run_id
          </button>
        </div>
        <p className="mt-4 text-xs text-neutral-500 font-mono">
          existing phase2_run_id: {state.existingPhase2RunId}
        </p>
      </div>
    )
  }

  if (state.kind === "case_not_supported") {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <p className="text-xs uppercase tracking-wide text-neutral-500">
          Phase 2 Bootstrap
        </p>
        <h1 className="text-2xl font-semibold text-neutral-900 mt-1">
          Not supported in this version
        </h1>
        <p className="mt-2 text-sm text-neutral-700">
          Phase 2 currently supports{" "}
          <strong>Case B positioning_runs only</strong>. Cases A and C
          ship in a later version.
        </p>
        {state.detail && (
          <div className="mt-4 p-3 bg-neutral-50 border border-neutral-200 rounded text-xs text-neutral-600 font-mono">
            {state.detail}
          </div>
        )}
        <div className="mt-6">
          <button
            onClick={onTryAnother}
            className="px-4 py-2 border border-neutral-300 text-neutral-700 text-sm font-medium rounded hover:bg-neutral-50"
          >
            Try a different positioning_run_id
          </button>
        </div>
      </div>
    )
  }

  if (state.kind === "persona_resume_text_empty") {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <p className="text-xs uppercase tracking-wide text-neutral-500">
          Phase 2 Bootstrap
        </p>
        <h1 className="text-2xl font-semibold text-neutral-900 mt-1">
          Persona needs a resume
        </h1>
        <p className="mt-2 text-sm text-neutral-700">
          This persona doesn&rsquo;t have a resume on file yet. Add a
          resume to the persona before starting Phase 2 — the workflow
          anchors every reframe against your existing resume content.
        </p>
        {state.detail && (
          <div className="mt-4 p-3 bg-neutral-50 border border-neutral-200 rounded text-xs text-neutral-600 font-mono">
            {state.detail}
          </div>
        )}
        <div className="mt-6 flex items-center gap-2">
          <a
            href="/dashboard"
            className="px-4 py-2 bg-neutral-900 text-white text-sm font-medium rounded hover:bg-neutral-800"
          >
            Go to dashboard
          </a>
          <button
            onClick={onTryAnother}
            className="px-4 py-2 border border-neutral-300 text-neutral-700 text-sm font-medium rounded hover:bg-neutral-50"
          >
            Try a different positioning_run_id
          </button>
        </div>
      </div>
    )
  }

  // state.kind === "other" — generic fallback
  return (
    <div className="p-8 max-w-2xl mx-auto">
      <p className="text-xs uppercase tracking-wide text-neutral-500">
        Phase 2 Bootstrap
      </p>
      <h1 className="text-2xl font-semibold text-red-700 mt-1">
        Couldn&rsquo;t start Phase 2
      </h1>
      <p className="mt-2 text-sm text-neutral-700">
        The /start endpoint returned an unexpected error.
      </p>
      <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
        <div>
          <span className="text-xs uppercase tracking-wide font-medium">
            HTTP {state.status}
          </span>{" "}
          · <code className="font-mono text-xs">{state.code}</code>
        </div>
        {state.detail && (
          <div className="mt-1 text-xs text-red-700">{state.detail}</div>
        )}
      </div>
      <div className="mt-6">
        <button
          onClick={onTryAnother}
          className="px-4 py-2 border border-neutral-300 text-neutral-700 text-sm font-medium rounded hover:bg-neutral-50"
        >
          Try again
        </button>
      </div>
    </div>
  )
}

