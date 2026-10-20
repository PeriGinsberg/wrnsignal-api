// GET ?round=<id> | ?workbook=<id> [&partial=1]
//
// The Performance Package for one practice round and/or one workbook: the
// Markdown and JSON files, plus short-lived signed URLs for the recordings.
// The coach's browser downloads the recordings and zips everything itself
// (components/academy/PerformancePackage.tsx), because a ZIP of eight videos
// is far over the 4.5 MB a Vercel function may return.
//
// Any workbook and any round, not only case rounds: a round names its
// workbook through workbook_id, and a workbook finds the round that names it,
// so asking for either gets both.
//
// INCOMPLETE WORK NEEDS ASKING FOR. Without partial=1, a round not yet
// submitted or a workbook not yet sent back is a 409 that says what is
// missing; with it, the package is built anyway and says it is partial.
//
// Full-access coaches only, the same gate as practice rounds and workbooks.
// The signed URLs last ten minutes and are never written into a file.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { ForbiddenError } from "@/lib/collab/scope"
import { coachPracticeScope, loadRound, NotFoundError } from "@/lib/practice/server"
import { getCase } from "@/lib/academy/cases"
import { rubricAverage } from "@/lib/academy/rubric"
import { packageFiles, recordingRefs, type PackageInput } from "@/lib/academy/package"
import type { WorkbookContent } from "@/lib/workbook/content"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  try {
    const { clientId } = await params
    const { db, scope } = await coachPracticeScope(req, clientId)
    const url = new URL(req.url)
    let roundId = url.searchParams.get("round")
    let workbookId = url.searchParams.get("workbook")
    const partial = url.searchParams.get("partial") === "1"
    if (!roundId && !workbookId) return withCorsJson(req, { ok: false, error: "Say which round or workbook" }, 400)

    // ── The round ──────────────────────────────────────────────────────
    if (!roundId && workbookId) {
      const { data } = await db.from("practice_rounds").select("id").eq("workbook_id", workbookId)
        .eq("client_profile_id", scope.subjectId).is("deleted_at", null)
        .order("created_at", { ascending: false }).limit(1)
      roundId = data?.[0]?.id ?? null
    }
    let roundPart: PackageInput["round"] = null
    if (roundId) {
      const { round, takes } = await loadRound(db, roundId, { id: scope.actorId, as: "coach" })
      if (round.client_profile_id !== scope.subjectId) throw new NotFoundError()
      const { data: extra } = await db.from("practice_rounds")
        .select("rubric, coach_review, review_updated_at").eq("id", roundId).maybeSingle()
      roundPart = {
        round, takes,
        rubric: (extra?.rubric as any) ?? null,
        review: (extra?.coach_review as any) ?? null,
        review_updated_at: extra?.review_updated_at ?? null,
        def: getCase(round.case_id),
      }
      if (!workbookId && round.workbook_id) workbookId = round.workbook_id
    }

    // ── The workbook ───────────────────────────────────────────────────
    let workbookPart: PackageInput["workbook"] = null
    if (workbookId) {
      const { data: wb, error } = await db.from("workbooks")
        .select("id, slug, status, content, created_at").eq("id", workbookId).eq("client_profile_id", scope.subjectId).maybeSingle()
      if (error) throw new Error(error.message)
      if (!wb) throw new NotFoundError()
      const [{ data: ans, error: aErr }, { data: sends }, { data: evaluations }] = await Promise.all([
        db.from("workbook_answers").select("field_key, value, updated_at").eq("workbook_id", workbookId),
        db.from("workbook_sends").select("direction, sent_at").eq("workbook_id", workbookId).order("sent_at", { ascending: true }),
        db.from("workbook_evaluations").select("section_id, ratings, note, updated_at").eq("workbook_id", workbookId),
      ])
      if (aErr) throw new Error(aErr.message)
      const answers: Record<string, { value: unknown; updated_at: string }> = {}
      for (const a of ans ?? []) answers[a.field_key] = { value: a.value, updated_at: a.updated_at }
      const content = wb.content as WorkbookContent
      workbookPart = { id: wb.id, slug: wb.slug, title: content.title ?? null, status: wb.status, created_at: wb.created_at, content, answers, sends: sends ?? [], evaluations: evaluations ?? [] }
    }

    // ── Incomplete? ────────────────────────────────────────────────────
    const missing: string[] = []
    if (roundPart && !["submitted", "feedback_sent"].includes(roundPart.round.status)) missing.push("the practice round has not been submitted")
    if (workbookPart && !workbookPart.sends.some((s) => s.direction === "to_coach")) missing.push("the workbook has not been sent back")
    if (missing.length && !partial) {
      return withCorsJson(req, { ok: false, incomplete: true, error: `Not finished yet: ${missing.join(" and ")}.`, missing }, 409)
    }

    // ── People and attempts ────────────────────────────────────────────
    const coachId = roundPart?.round.coach_profile_id ?? scope.viaCoachId ?? scope.actorId
    const [{ data: student }, { data: coach }, { data: attempts }] = await Promise.all([
      db.from("client_profiles").select("id, name, email").eq("id", scope.subjectId).maybeSingle(),
      db.from("client_profiles").select("id, name").eq("id", coachId).maybeSingle(),
      db.from("practice_rounds").select("id, title, case_id, status, submitted_at, rubric")
        .eq("client_profile_id", scope.subjectId).eq("kind", "case").is("deleted_at", null).order("created_at", { ascending: true }),
    ])

    const input: PackageInput = {
      generated_at: new Date().toISOString(),
      partial: missing.length > 0,
      student: { profile_id: scope.subjectId, name: String(student?.name ?? "").trim() || "Student", email: student?.email ?? null },
      coach: { profile_id: coachId, name: String(coach?.name ?? "").trim() || "Coach" },
      workbook: workbookPart,
      round: roundPart,
      attempts: (attempts ?? []).map((a: any) => ({
        id: a.id, title: a.title, case_id: a.case_id, status: a.status, submitted_at: a.submitted_at, rubric_average: rubricAverage(a.rubric),
      })),
    }

    const refs = recordingRefs(input)
    const signed: Record<string, string> = {}
    if (refs.length) {
      const { data, error } = await db.storage.from("practice-takes").createSignedUrls(refs.map((r) => r.storage_path), 600)
      if (error) console.error("[performance-package] signing failed:", error.message)
      ;(data ?? []).forEach((d, i) => { if (d.signedUrl) signed[refs[i].path] = d.signedUrl })
    }

    const name = input.student.name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")
    const what = roundPart?.round.title ?? workbookPart?.title ?? "Performance"
    return withCorsJson(req, {
      ok: true,
      partial: input.partial,
      missing,
      folder: `${name}_${what.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 50)}_${input.generated_at.slice(0, 10)}`,
      files: packageFiles(input),
      recordings: refs.map((r) => ({ path: r.path, url: signed[r.path] ?? null, kind: r.kind, question: r.question })),
      // The README needs to know which downloads worked, so the browser fills
      // it; this is everything it needs that the browser cannot know.
      no_answer: input.round
        ? input.round.round.questions.map((q, i) => ({ n: i + 1, answered: input.round!.takes.some((t) => t.question_id === q.id) })).filter((x) => !x.answered).map((x) => x.n)
        : [],
      has_round: !!input.round,
    })
  } catch (e: any) {
    if (e instanceof NotFoundError) return withCorsJson(req, { ok: false, error: "Not found" }, 404)
    if (e instanceof ForbiddenError) return withCorsJson(req, { ok: false, error: "Forbidden" }, 403)
    console.error("[performance-package]", e?.message ?? e)
    return withCorsJson(req, { ok: false, error: "Something went wrong" }, 500)
  }
}
