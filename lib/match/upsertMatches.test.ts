// Run: npx tsx lib/match/upsertMatches.test.ts
//
// posting_matches writes, offline: batch size, retry on a gateway's HTML error
// page (Cole's match run, 2026-10-30), and no retry on a real database error.

import { isTransientDbError, upsertMatches, UPSERT_BATCH } from "./runMatching"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

const HTML = "<!DOCTYPE html>\n<!--[if lt IE 7]> <html class=\"no-js ie6 oldie\" lang=\"en-US\"> <![endif]-->"

/** A posting_matches table whose upserts answer from `script`, in order, then succeed. */
function fakeSb(script: { message: string; status: number }[]) {
  const batches: number[] = []
  const sb: any = {
    from: () => ({
      upsert: async (rows: any[]) => {
        batches.push(rows.length)
        const e = script.shift()
        return e ? { error: { message: e.message }, status: e.status } : { error: null, status: 201 }
      },
    }),
  }
  return { sb, batches }
}
const waits: number[] = []
const wait = async (ms: number) => { waits.push(ms) }
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ posting_id: `p${i}` }))

;(async () => {
  ok("transient: an HTML page, a 5xx, a dropped connection", isTransientDbError({ message: HTML, status: 520 }) && isTransientDbError({ message: "x", status: 503 }) && isTransientDbError({ message: "TypeError: fetch failed" }))
  ok("not transient: a constraint or a bad column", !isTransientDbError({ message: 'violates check constraint "x"', status: 400 }) && !isTransientDbError({ message: 'column "y" does not exist', status: 400 }))

  {
    const { sb, batches } = fakeSb([])
    await upsertMatches(sb, rows(250), wait)
    ok(`batches of ${UPSERT_BATCH}`, UPSERT_BATCH === 100 && JSON.stringify(batches) === "[100,100,50]")
  }
  {
    waits.length = 0
    const { sb, batches } = fakeSb([{ message: HTML, status: 520 }, { message: HTML, status: 520 }])
    await upsertMatches(sb, rows(150), wait)
    ok("an HTML error page is retried until it goes through", JSON.stringify(batches) === "[100,100,100,50]" && JSON.stringify(waits) === "[2000,6000]")
  }
  {
    const { sb, batches } = fakeSb([{ message: HTML, status: 520 }, { message: HTML, status: 520 }, { message: HTML, status: 520 }])
    const e = await upsertMatches(sb, rows(150), wait).then(() => null, (x) => x as Error)
    ok("three failures: thrown, naming the rows and attempts, without the page", !!e && batches.length === 3 && /rows 1-100 of 150, 3 attempt/.test(e.message) && /HTTP 520/.test(e.message) && !e.message.includes("<!DOCTYPE"))
  }
  {
    const { sb, batches } = fakeSb([{ message: 'violates check constraint "posting_matches_score"', status: 400 }])
    const e = await upsertMatches(sb, rows(10), wait).then(() => null, (x) => x as Error)
    ok("a real database error is thrown at once, not retried", !!e && batches.length === 1 && /check constraint/.test(e.message))
  }

  console.log(failures ? `\n${failures} failure(s)` : "\nall passed")
  if (failures) process.exit(1)
})().catch((e) => { console.error(e); process.exit(1) })
