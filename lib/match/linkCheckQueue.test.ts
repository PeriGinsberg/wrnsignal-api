// Run: npx tsx lib/match/linkCheckQueue.test.ts
//
// The link check's queue reads, offline. 2026-11-01: one query for every
// client's top 30 hit the statement timeout and the whole step failed. Now
// each client's queue is its own query, retried once, and a client whose queue
// cannot be read does not stop the others.

import { QUEUE_READ_ATTEMPTS, runLinkCheck } from "./linkCheck"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

const TIMEOUT = { message: "canceling statement due to statement timeout" }

/** client_match_criteria lists `clients`; each queue read answers from failsLeft[client] errors, then rows (no apply_url, so nothing is fetched). */
function fakeSb(clients: string[], failsLeft: Record<string, number>) {
  const queueReads: { filters: Record<string, unknown> }[] = []
  const sb: any = {
    from: (table: string) => {
      const filters: Record<string, unknown> = {}
      const answer = () => {
        if (table === "client_match_criteria") return { data: clients.map((c) => ({ client_profile_id: c })), error: null }
        if (table === "client_match_queue") {
          queueReads.push({ filters: { ...filters } })
          const id = filters.client_profile_id as string
          if ((failsLeft[id] ?? 0) > 0) { failsLeft[id]--; return { data: null, error: TIMEOUT } }
          return { data: [{ client_profile_id: id, posting_id: id + "-p1", title: "t", company: "c", apply_url: null, rank: 1 }], error: null }
        }
        throw new Error("unexpected table " + table)
      }
      const b: any = {
        select: () => b, order: () => b,
        eq: (k: string, v: unknown) => { filters[k] = v; return b },
        lte: (k: string, v: unknown) => { filters[k + "<="] = v; return b },
        then: (res: any, rej: any) => Promise.resolve(answer()).then(res, rej),
      }
      return b
    },
  }
  return { sb, queueReads }
}

;(async () => {
  {
    const { sb, queueReads } = fakeSb(["a", "b", "c"], {})
    const s = await runLinkCheck(sb, { top: 30, dryRun: true })
    ok("one queue read per active client", queueReads.length === 3)
    ok("every queue read is filtered to one client and the top 30", queueReads.every((r) => typeof r.filters.client_profile_id === "string" && r.filters["rank<="] === 30))
    ok("no errors when every queue reads", s.queueErrors.length === 0)
  }
  {
    const { sb, queueReads } = fakeSb(["a", "b"], { b: 1 })
    const s = await runLinkCheck(sb, { top: 30, dryRun: true })
    ok("a timeout is retried, and the retry's rows are used", s.queueErrors.length === 0 && queueReads.filter((r) => r.filters.client_profile_id === "b").length === 2)
  }
  {
    const { sb, queueReads } = fakeSb(["a", "b", "c"], { b: 99 })
    const s = await runLinkCheck(sb, { top: 30, dryRun: true })
    ok(`a client failing ${QUEUE_READ_ATTEMPTS} times is reported, not thrown`, s.queueErrors.length === 1 && s.queueErrors[0].clientProfileId === "b" && /statement timeout/.test(s.queueErrors[0].error))
    ok("the clients after it are still read", queueReads.some((r) => r.filters.client_profile_id === "c"))
    ok(`no more than ${QUEUE_READ_ATTEMPTS} tries for the failing client`, queueReads.filter((r) => r.filters.client_profile_id === "b").length === QUEUE_READ_ATTEMPTS)
  }
  {
    const { sb, queueReads } = fakeSb(["a", "b"], {})
    await runLinkCheck(sb, { top: 10, clientProfileId: "z", dryRun: true })
    ok("--client reads only that client's queue", queueReads.length === 1 && queueReads[0].filters.client_profile_id === "z" && queueReads[0].filters["rank<="] === 10)
  }

  console.log(failures ? `\n${failures} failure(s)` : "\nall passed")
  if (failures) process.exit(1)
})()
