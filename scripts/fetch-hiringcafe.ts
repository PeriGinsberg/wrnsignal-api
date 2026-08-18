#!/usr/bin/env tsx
/**
 * CLI for the hiring.cafe fetcher. The fetcher itself lives in
 * lib/hiringcafe.ts, because app/api/lanes/discover-titles imports it too and
 * a web route should not be pulling a command-line entry point into its bundle.
 *
 * Usage:
 *   npx tsx scripts/fetch-hiringcafe.ts \
 *     --query "sports coordinator" --location nyc --radius 25 --days 29 \
 *     --seniority "No Prior Experience Required,Entry Level,Mid Level"
 *
 *   --location none   no geographic filter at all (see SearchOpts.location)
 *   --pages 3         fetch 3 pages (page size is ~40-60, set by the server)
 *   --json            emit the parsed rows as JSON instead of the table
 */

import { fetchJobs, SENIORITY_LEVELS } from "../lib/hiringcafe"

// Re-exported so existing importers (run-search-lane.ts, propose-search-lane.ts)
// keep working against this path.
export { LOCATIONS, SENIORITY_LEVELS, buildSearchState, resolveBuildId, fetchJobs, queryFor } from "../lib/hiringcafe"
export type { SearchOpts, JobRow } from "../lib/hiringcafe"

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : fallback
}

async function main() {
  const opts = {
    query: arg("query", "sports coordinator")!,
    // --location none searches with no geographic filter; otherwise a
    // comma-separated list of preset keys.
    locations: arg("location", "nyc") === "none" ? [] : arg("location", "nyc")!.split(",").map((x) => x.trim()).filter(Boolean),
    radiusMiles: Number(arg("radius", "25")),
    days: Number(arg("days", "29")),
    seniority: arg("seniority", "No Prior Experience Required,Entry Level,Mid Level")!
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    pages: Number(arg("pages", "1")),
  }

  const unknown = opts.seniority.filter((s) => !SENIORITY_LEVELS.includes(s as any))
  if (unknown.length) {
    throw new Error(
      `Unknown seniority ${JSON.stringify(unknown)}. Valid: ${SENIORITY_LEVELS.join(" | ")}`
    )
  }

  const { rows, total } = await fetchJobs(opts)

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(rows, null, 2))
    return
  }

  console.log(
    `query="${opts.query}" locations=${opts.locations.join(",") || "(none)"} radius=${opts.radiusMiles}mi ` +
      `days=${opts.days} seniority=[${opts.seniority.join(", ")}]`
  )
  console.log(`${total} total, ${rows.length} fetched\n`)

  for (const r of rows) {
    const pay =
      r.salary_min && r.salary_max
        ? `$${Math.round(r.salary_min / 1000)}k-$${Math.round(r.salary_max / 1000)}k`
        : "—"
    console.log(
      [
        r.title,
        `@ ${r.company}`,
        `| ${r.seniority}`,
        `| ${r.location}`,
        `| ${r.workplace_type}`,
        `| ${pay}`,
        `| ${String(r.posted_at).slice(0, 10)}`,
      ].join(" ")
    )
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message)
    process.exit(1)
  })
}
