// app/positioning/phase2/[id]/page.tsx
//
// Phase 2 selection screen — the entry point of the workflow prototype.
// Renders the list of recommended items + a "I'm done" CTA that routes
// to the completion screen.
//
// FRD: docs/Features/positioning-phase2-frd.md §5.2 selection screen
//
// Entry: user lands at /positioning/phase2/[id] where [id] is a
// phase2_run_id (obtained via POST /api/positioning/v2/phase2/start;
// for v0.1 prototype, the id is supplied manually in the URL).
//
// Calls GET /api/positioning/v2/phase2/[id] on mount.

"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  apiCall,
  type Phase2RunResponse,
  type PhaseTwoItem,
} from "@/lib/positioning-prototype"

export default function Phase2SelectionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const router = useRouter()
  const [phase2RunId, setPhase2RunId] = useState<string>("")
  const [viewState, setViewState] = useState<"loading" | "loaded" | "error">(
    "loading",
  )
  const [data, setData] = useState<Phase2RunResponse | null>(null)
  const [error, setError] = useState<{ status: number; message: string }>({
    status: 0,
    message: "",
  })

  useEffect(() => {
    async function load() {
      const { id } = await params
      setPhase2RunId(id)
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
      setData(result.data)
      setViewState("loaded")
    }
    load()
  }, [params])

  if (viewState === "loading") {
    return <div className="p-8 text-neutral-500 text-sm">Loading Phase 2 run…</div>
  }

  if (viewState === "error") {
    return (
      <div className="p-8 max-w-2xl">
        <h1 className="text-2xl font-semibold text-red-700">Error</h1>
        <p className="mt-2 text-neutral-700">
          {error.status === 404
            ? "Phase 2 run not found."
            : `${error.status}: ${error.message}`}
        </p>
        {error.status === 404 && (
          <p className="mt-4 text-sm text-neutral-500">
            Create a phase2_run via{" "}
            <code className="bg-neutral-100 px-1 py-0.5 rounded text-xs">
              POST /api/positioning/v2/phase2/start
            </code>{" "}
            first, then navigate to{" "}
            <code className="bg-neutral-100 px-1 py-0.5 rounded text-xs">
              /positioning/phase2/&lt;id&gt;
            </code>
            .
          </p>
        )}
      </div>
    )
  }

  // viewState === "loaded"
  const run = data!
  const items = run.state.items
  const isFinalized = run.status !== "in_progress"

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <p className="text-xs uppercase tracking-wide text-neutral-500">
          Phase 2 Run
        </p>
        <h1 className="text-2xl font-semibold text-neutral-900 mt-1">
          Resume Reframing Workflow
        </h1>
        <div className="mt-2 flex items-center gap-3 text-sm">
          <StatusPill status={run.status} />
          <span className="text-neutral-500">Case {run.case_letter}</span>
          <span className="text-neutral-400">·</span>
          <span className="text-neutral-500 font-mono text-xs">
            {phase2RunId.slice(0, 8)}…
          </span>
        </div>
      </div>

      {/* Heads-up notice — only show when in_progress (no point on finalized) */}
      {!isFinalized && (
        <div className="mb-6 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-900">
          <strong>Heads up:</strong> In this version, accept/decline/skip
          decisions are final once submitted. Consider carefully before
          deciding. Revise capability is planned for v0.2.
        </div>
      )}

      {/* Items list */}
      <div className="space-y-3">
        {items.length === 0 ? (
          <div className="border border-neutral-200 rounded p-6 text-neutral-500 text-sm">
            <p className="font-medium text-neutral-700">No items to review.</p>
            <p className="mt-2">
              In v0.1, <code className="bg-neutral-100 px-1 rounded text-xs">populateItems</code>{" "}
              returns an empty array. Real population logic lands in Stage 2c.
            </p>
          </div>
        ) : (
          items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              onClick={() =>
                router.push(
                  `/positioning/phase2/${phase2RunId}/items/${item.id}`,
                )
              }
              disabled={isFinalized}
            />
          ))
        )}
      </div>

      {/* Footer actions */}
      <div className="mt-8 pt-6 border-t border-neutral-200 flex items-center justify-between">
        <div className="text-sm text-neutral-500">
          {isFinalized
            ? `Run ${run.status} — read-only`
            : run.state.completion_offered
              ? "All items decided — ready to complete"
              : "Click “I’m done” when ready"}
        </div>
        {!isFinalized ? (
          <button
            onClick={() =>
              router.push(`/positioning/phase2/${phase2RunId}/complete`)
            }
            className="px-4 py-2 bg-neutral-900 text-white text-sm font-medium rounded hover:bg-neutral-800"
          >
            I&rsquo;m done
          </button>
        ) : (
          <a
            href="/dashboard"
            className="px-4 py-2 border border-neutral-300 text-neutral-700 text-sm font-medium rounded hover:bg-neutral-50"
          >
            Back to Dashboard
          </a>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Subcomponents
// ============================================================================

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    in_progress: "bg-blue-100 text-blue-700",
    completed: "bg-green-100 text-green-700",
    abandoned: "bg-neutral-200 text-neutral-600",
  }
  const cls = styles[status] ?? "bg-neutral-100 text-neutral-700"
  return (
    <span
      className={`text-xs uppercase tracking-wide font-medium px-2 py-0.5 rounded ${cls}`}
    >
      {status.replace("_", " ")}
    </span>
  )
}

function ItemCard({
  item,
  onClick,
  disabled,
}: {
  item: PhaseTwoItem
  onClick: () => void
  disabled: boolean
}) {
  const typeStyles: Record<string, string> = {
    headline: "bg-purple-100 text-purple-700",
    bullet: "bg-orange-100 text-orange-700",
    gap: "bg-blue-100 text-blue-700",
  }
  const decisionColor = item.accepted
    ? "text-green-700"
    : item.declined
      ? "text-red-700"
      : item.skipped
        ? "text-neutral-500"
        : "text-neutral-400"
  const decisionLabel = item.accepted
    ? "Accepted"
    : item.declined
      ? "Declined"
      : item.skipped
        ? "Skipped"
        : "Not started"

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full text-left border border-neutral-200 rounded p-4 hover:border-neutral-400 hover:bg-neutral-50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`text-[10px] uppercase tracking-wide font-medium px-2 py-0.5 rounded ${typeStyles[item.type]}`}
            >
              {item.type}
            </span>
            <span className={`text-xs font-medium ${decisionColor}`}>
              {decisionLabel}
            </span>
          </div>
          <p className="text-sm text-neutral-900">{item.label}</p>
        </div>
        <span className="text-neutral-300 text-xl">›</span>
      </div>
    </button>
  )
}
