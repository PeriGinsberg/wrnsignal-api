/**
 * Phase 2 enrichment check: enrich postings with lib/ingest/enrich.ts on one or
 * more models and lay the years and deadline answers beside the sentences that
 * state them, for checking by hand (BUILD-PLAN.md Phase 2).
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ANTHROPIC_API_KEY=... \
 *     NODE_OPTIONS=--use-system-ca npx tsx tests/ingest/eval-enrich-models.ts \
 *     --since 2026-10-25T18:01:42Z --n 50 --out <dir>
 *
 * Which postings, one of:
 *   --since <ts> [--n 50]   SearchApi postings created since <ts>, ordered by
 *                           fingerprint (a hash: effectively random, repeatable)
 *   --ids <file.json>       a JSON array of posting ids, any source
 *   --from <results.json>   no model or database calls: rebuild the tables
 *
 * --models haiku,sonnet (default both).
 *
 * READ-ONLY on the database: selects only. Writes only to --out: results.json,
 * years.csv / years.md (the hand-check table, with deadlines), fields.csv.
 */

import { mkdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
import { ENRICH_MODELS, enrichPosting, type EnrichFields, type EnrichModel, type EnrichUsage } from "../../lib/ingest/enrich"
import { descriptionOf } from "../../lib/ingest/enrichPostings"

const arg = (name: string) => {
  const i = process.argv.indexOf("--" + name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const SINCE = arg("since")
const IDS = arg("ids")
const FROM = arg("from")
const N = Number(arg("n") ?? 50)
const OUT = arg("out")!
const MODELS = (arg("models") ?? "haiku,sonnet").split(",") as (keyof typeof ENRICH_MODELS)[]
if (!OUT || !(SINCE || IDS || FROM)) { console.error("--out and one of --since / --ids / --from are required"); process.exit(1) }
if (MODELS.some((m) => !ENRICH_MODELS[m])) { console.error(`--models must be from: ${Object.keys(ENRICH_MODELS).join(",")}`); process.exit(1) }
if (!FROM) for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY"]) {
  if (!process.env[k]) { console.error(`${k} must be set`); process.exit(1) }
}

// ---- display aids for the hand check. Never used to extract anything.
const NUM = "(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen)"
const YEARS_RE = new RegExp(
  `\\b${NUM}(?:\\s*\\(\\d+\\))?\\s*(?:\\+|plus|or more|or greater)?\\s*(?:(?:-|‑|–|to)\\s*${NUM}\\s*\\+?\\s*)?(?:years?|yrs?|months?)\\b` +
    `|\\b(?:years?|yrs?) of (?:experience|work)|no (?:prior )?experience|entry[- ]level|new grad|recent (?:college )?graduate`,
  "i",
)
const DEADLINE_RE = /deadline|apply by|applications? (?:close|are due|due|will be accepted)|accept(?:ing|ed) applications|applications accepted/i
/** Longer than this, a "sentence" is a run-on block (the source has no breaks): show a window. */
const MAX_SENTENCE = 260
function sentencesMatching(text: string, re: RegExp): string[] {
  return text
    .split(/\n+|(?<=[.!?;])\s+(?=[A-Z•-])/)
    .map((s) => s.replace(/^[-•*\s]+/, "").trim())
    .filter((s) => s && re.test(s))
    .map((s) => {
      if (s.length <= MAX_SENTENCE) return s
      const i = s.search(re)
      const a = Math.max(0, i - 110), b = Math.min(s.length, i + 150)
      return (a > 0 ? "…" : "") + s.slice(a, b).trim() + (b < s.length ? "…" : "")
    })
}
const squash = (s: string) =>
  s.replace(/[\s ]+/g, " ").replace(/[‐‑–—]/g, "-").replace(/[’‘]/g, "'").replace(/…/g, "").trim().toLowerCase()
/** A model's evidence quote counts only if it appears in the description. */
const quoteFound = (quote: string, text: string) => !quote.trim() || squash(text).includes(squash(quote))

type Result = { fields: EnrichFields | null; usage: EnrichUsage | null; error: string | null; ms: number }
type Row = { n: number; id: string; source?: string; title: string; company: string; location: string | null; results: Record<string, Result> }
type Saved = { selection?: string; project?: string; models?: string[]; rows: Row[]; descriptions: Record<string, string> }

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    for (;;) { const i = next++; if (i >= items.length) return; out[i] = await fn(items[i]) }
  }))
  return out
}

const yearsText = (r: Result | undefined) => {
  if (!r?.fields) return "ERROR " + (r?.error ?? "").slice(0, 60)
  const { years_min: a, years_max: b, years_basis: basis } = r.fields
  if (a === "not_stated" && b === "not_stated") return "not stated"
  const range = a === b ? `${a}` : b === "not_stated" ? `${a}+` : `${a === "not_stated" ? "?" : a}-${b}`
  return range + (basis === "preferred" ? " (preferred)" : "")
}
const deadlineText = (r: Result | undefined) => {
  if (!r?.fields) return "ERROR"
  const f = r.fields
  return f.application_deadline ?? (f.deadline_evidence.trim() ? "stated, no full date" : "not stated")
}
const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`
const md = (v: unknown) => String(v ?? "").replace(/\|/g, "/").replace(/\r?\n/g, " ")

/** results.json from before --models existed kept haiku and sonnet as top-level keys. */
function normalise(saved: any): Saved {
  return {
    ...saved,
    rows: saved.rows.map((r: any) => r.results ? r : { ...r, results: Object.fromEntries(["haiku", "sonnet"].filter((m) => r[m]).map((m) => [m, r[m]])) }),
  }
}

function writeTables(saved: Saved) {
  mkdirSync(OUT, { recursive: true })
  const models = Object.keys(saved.rows[0]?.results ?? {})
  const rows = saved.rows.map((r) => {
    const text = saved.descriptions[r.id]
    const withQuotes = (found: string[], key: "years_evidence" | "deadline_evidence") => {
      // The regex misses some phrasings; a model's quote fills the gap, but only
      // once it is confirmed to be in the description.
      const quotes = models.map((m) => r.results[m]?.fields?.[key]).filter(
        (q): q is string => !!q && !!q.trim() && quoteFound(q, text) &&
          !found.some((f) => squash(f).includes(squash(q)) || squash(q).includes(squash(f))),
      )
      return [...found, ...[...new Set(quotes)].map((q) => q + " [model quote]")]
    }
    return {
      ...r,
      years_sentences: withQuotes(sentencesMatching(text, YEARS_RE), "years_evidence"),
      deadline_sentences: withQuotes(sentencesMatching(text, DEADLINE_RE), "deadline_evidence"),
      quote_ok: Object.fromEntries(models.map((m) => {
        const f = r.results[m]?.fields
        return [m, !f || (quoteFound(f.years_evidence, text) && quoteFound(f.deadline_evidence, text))]
      })),
    }
  })

  writeFileSync(join(OUT, "years.csv"), [
    ["n", "source", "title", "company", "sentence(s) stating years", ...models, "sentence(s) stating a deadline", ...models.map((m) => `${m} deadline`)].map(csv).join(","),
    ...rows.map((r) => [r.n, r.source, r.title, r.company, r.years_sentences.join(" | ") || "(none)", ...models.map((m) => yearsText(r.results[m])),
      r.deadline_sentences.join(" | ") || "(none)", ...models.map((m) => deadlineText(r.results[m]))].map(csv).join(",")),
  ].join("\n"))

  writeFileSync(join(OUT, "years.md"), [
    `| # | Title | Company | Sentence(s) stating years | ${models.join(" | ")} | Sentence(s) stating a deadline | ${models.map((m) => m + " deadline").join(" | ")} |`,
    `|---|---|---|---|${models.map(() => "---|").join("")}---|${models.map(() => "---|").join("")}`,
    ...rows.map((r) => `| ${r.n} | ${md(r.title)} | ${md(r.company)} | ${md(r.years_sentences.join(" / ") || "(none)")} | ${models.map((m) => md(yearsText(r.results[m]))).join(" | ")} | ${md(r.deadline_sentences.join(" / ") || "(none)")} | ${models.map((m) => md(deadlineText(r.results[m]))).join(" | ")} |`),
  ].join("\n"))

  const F = (f: EnrichFields | null | undefined) => f ? [
    f.cleaned_title, `${f.years_min}/${f.years_max}/${f.years_basis}`, `${f.graduation_from ?? ""}..${f.graduation_to ?? ""}`,
    `${f.salary_low}-${f.salary_high} ${f.salary_period} ${f.salary_currency ?? ""}`, f.requirements_summary,
    Array.isArray(f.tools) ? f.tools.join("; ") : f.tools, f.level, f.function, f.industry,
    f.application_deadline ?? (f.deadline_evidence ? "(no full date)" : ""),
  ] : Array(10).fill("")
  const heads = ["cleaned_title", "years", "graduation", "salary", "summary", "tools", "level", "function", "industry", "deadline"]
  writeFileSync(join(OUT, "fields.csv"), [
    ["n", "title", "company", ...heads.flatMap((h) => models.map((m) => `${m} ${h}`))].map(csv).join(","),
    ...rows.map((r) => {
      const cols = models.map((m) => F(r.results[m]?.fields))
      return [r.n, r.title, r.company, ...heads.flatMap((_, k) => cols.map((c) => c[k]))].map(csv).join(",")
    }),
  ].join("\n"))

  if (models.length >= 2) {
    const [a, b] = models
    const both = rows.filter((r) => r.results[a]?.fields && r.results[b]?.fields)
    const agree = (k: (f: EnrichFields) => unknown) =>
      both.filter((r) => JSON.stringify(k(r.results[a].fields!)) === JSON.stringify(k(r.results[b].fields!))).length
    console.log(`\nAgreement over ${both.length} postings both models enriched:`)
    console.log(`  years (min,max) ${agree((f) => [f.years_min, f.years_max])}, basis ${agree((f) => f.years_basis)}, graduation ${agree((f) => [f.graduation_from, f.graduation_to])}, salary ${agree((f) => [f.salary_low, f.salary_high, f.salary_period])}`)
    console.log(`  level ${agree((f) => f.level)}, function ${agree((f) => f.function)}, industry ${agree((f) => f.industry)}, deadline ${agree((f) => f.application_deadline)}, cleaned title ${agree((f) => f.cleaned_title)}, tools ${agree((f) => Array.isArray(f.tools) ? [...f.tools].sort() : f.tools)}`)
  }
  console.log(`  postings with a years sentence shown: ${rows.filter((r) => r.years_sentences.length).length}, with a deadline sentence: ${rows.filter((r) => r.deadline_sentences.length).length}`)
  console.log(`  evidence quotes NOT found verbatim in the description: ${models.map((m) => `${m} ${rows.filter((r) => !r.quote_ok[m]).length}`).join(", ")}`)
  console.log(`\nWrote ${OUT}`)
}

;(async () => {
  if (FROM) return writeTables(normalise(JSON.parse(readFileSync(FROM, "utf8"))))

  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const ref = new URL(process.env.SUPABASE_URL!).hostname.split(".")[0]
  let sample: any[]
  if (IDS) {
    const ids: string[] = JSON.parse(readFileSync(IDS, "utf8"))
    const { data, error } = await sb.from("postings").select("id, source, title, company, location, raw").in("id", ids)
    if (error) throw error
    // Keep the file's order, so the table numbers match it.
    sample = ids.map((id) => data!.find((p: any) => p.id === id)).filter(Boolean)
    console.log(`Project ${ref}: ${sample.length} of ${ids.length} ids found.`)
  } else {
    const { data, error } = await sb
      .from("postings")
      .select("id, fingerprint, source, title, company, location, raw")
      .eq("source", "searchapi")
      .gte("created_at", SINCE!)
      .order("fingerprint")
    if (error) throw error
    const withText = (data ?? []).filter((p: any) => String(p.raw?.description ?? "").length >= 200)
    sample = withText.slice(0, N)
    console.log(`Project ${ref}: ${data!.length} SearchApi postings since ${SINCE}, ${withText.length} with a description, taking ${sample.length}.`)
  }
  // SearchApi keeps text in raw.description (and Google's title in raw.title);
  // Greenhouse keeps HTML in raw.content.
  const textOf = (p: any) => p.source === "searchapi" ? String(p.raw?.description ?? "") : descriptionOf(p.raw)
  const titleOf = (p: any) => p.source === "searchapi" ? (p.raw?.title ?? p.title) : p.title

  const runs: Record<string, Result[]> = {}
  for (const name of MODELS) {
    const model: EnrichModel = ENRICH_MODELS[name]
    const t0 = Date.now()
    runs[name] = await pool(sample, 5, async (p: any) => {
      const s = Date.now()
      try {
        const r = await enrichPosting({ title: titleOf(p), company: p.company, location: p.location, description: textOf(p) }, { model, effort: "medium" })
        return { fields: r.fields, usage: r.usage, error: null, ms: Date.now() - s }
      } catch (e: any) {
        return { fields: null, usage: e?.usage ?? null, error: String(e?.message ?? e), ms: Date.now() - s }
      }
    })
    const rs = runs[name]
    const cost = rs.reduce((n, r) => n + (r.usage?.costUsd ?? 0), 0)
    const tok = (k: keyof EnrichUsage) => rs.reduce((n, r) => n + Number(r.usage?.[k] ?? 0), 0)
    console.log(
      `${name} (${model}): ${rs.filter((r) => r.fields).length}/${rs.length} ok, ${rs.filter((r) => r.error).length} failed, ` +
        `${tok("attempts")} calls, ${((Date.now() - t0) / 1000).toFixed(0)}s. ` +
        `Tokens: input ${tok("inputTokens")}, cache read ${tok("cacheReadTokens")}, cache write ${tok("cacheWriteTokens")}, output ${tok("outputTokens")}. ` +
        `Cost $${cost.toFixed(4)} total, $${(cost / rs.length).toFixed(5)} per posting.`,
    )
    for (const r of rs) if (r.error) console.log(`  failed: ${r.error.slice(0, 200)}`)
  }

  const saved: Saved = {
    selection: IDS ? `ids:${IDS}` : `since:${SINCE}`, project: ref, models: MODELS,
    rows: sample.map((p: any, i: number) => ({
      n: i + 1, id: p.id, source: p.source, title: titleOf(p), company: p.company, location: p.location,
      results: Object.fromEntries(MODELS.map((m) => [m, runs[m][i]])),
    })),
    descriptions: Object.fromEntries(sample.map((p: any) => [p.id, textOf(p)])),
  }
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, "results.json"), JSON.stringify(saved, null, 2))
  writeTables(saved)
})().catch((e) => { console.error(e); process.exit(1) })
