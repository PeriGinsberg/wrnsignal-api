// Run: npx tsx lib/collab/teamAddedJob.test.ts
//
// A job a coach added (Job Queue Add Job, Source a Job) is deletable by the
// client's team whether or not its recommendation link exists; a job the client
// added never is.

import { teamAddedJob } from "./delegation"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) } else console.log(`  ok    ${label}`)
}

/** A fake Supabase client: every select returns the table's rows, filtered by eq/in. */
function fake(tables: Record<string, any[]>) {
  return {
    from(table: string) {
      let rows = tables[table] ?? []
      const q: any = {
        select: () => q,
        eq: (c: string, v: any) => { rows = rows.filter((r) => r[c] === v); return q },
        in: (c: string, vs: any[]) => { rows = rows.filter((r) => vs.includes(r[c])); return q },
        then: (res: any) => res({ data: rows, error: null }),
      }
      return q
    },
  } as any
}

const CLIENT = "client-1", COACH = "coach-1", DELEGATE = "coach-2", OTHER = "coach-9"
const base = {
  coach_clients: [{ coach_profile_id: COACH, client_profile_id: CLIENT, status: "active" }],
  coach_delegates: [{ principal_coach_profile_id: COACH, delegate_coach_profile_id: DELEGATE, status: "active" }],
}
const app = (over: Record<string, any> = {}) => ({ id: "app-1", profile_id: CLIENT, added_by_role: "client", added_by_profile_id: null, ...over })

;(async () => {
  const linked = await teamAddedJob(fake({ ...base, coach_job_recommendations: [{ id: "rec-1", application_id: "app-1", client_profile_id: CLIENT, coach_profile_id: COACH }] }), app({ added_by_role: "coach", added_by_profile_id: COACH }))
  ok("linked recommendation: coach-added, recommendation returned", linked.coachAdded && linked.recIds.join() === "rec-1")

  const unlinked = await teamAddedJob(fake({ ...base, coach_job_recommendations: [] }), app({ added_by_role: "coach", added_by_profile_id: COACH }))
  ok("no link, job says the coach added it: coach-added", unlinked.coachAdded && unlinked.recIds.length === 0)

  const delegate = await teamAddedJob(fake({ ...base, coach_job_recommendations: [] }), app({ added_by_role: "coach", added_by_profile_id: DELEGATE }))
  ok("added by the coach's delegate: coach-added", delegate.coachAdded)

  const outsider = await teamAddedJob(fake({ ...base, coach_job_recommendations: [] }), app({ added_by_role: "coach", added_by_profile_id: OTHER }))
  ok("added by a coach not on the team: not deletable", !outsider.coachAdded)

  const client = await teamAddedJob(fake({ ...base, coach_job_recommendations: [] }), app())
  ok("the client added it: not deletable", !client.coachAdded)

  console.log(failures ? `\n${failures} failed` : "\nall passed")
  if (failures) process.exit(1)
})()
