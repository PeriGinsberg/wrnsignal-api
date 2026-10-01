// tests/_lib/fakeSupabase.ts
//
// An in-memory stand-in for the slice of the Supabase query builder the task,
// automation and access code uses: select / insert / update, eq, neq, in, is,
// lt, or (flat expressions only), order, limit, maybeSingle, single, and
// awaiting the builder itself.
//
// For logic tests, not for database behaviour. Row locking, constraints and
// RLS are Postgres's; anything that depends on them is exercised by the
// smokes in tests/tasks and tests/automation against dev.

export type Row = Record<string, any>

type Pred = (r: Row) => boolean

let seq = 0
const newId = () => `fake-${++seq}`

function parseValue(v: string): any {
  if (v === "null") return null
  if (v === "true") return true
  if (v === "false") return false
  return v
}

/** Split on commas that are not inside parentheses. */
function splitTop(expr: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ""
  for (const ch of expr) {
    if (ch === "(") depth++
    if (ch === ")") depth--
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}

function orTerm(term: string): Pred {
  const m = term.match(/^([a-z_]+)\.(eq|neq|is|lt|gt|in)\.(.*)$/)
  if (!m) throw new Error(`fakeSupabase: unsupported or() term: ${term}`)
  const [, col, op, raw] = m
  if (op === "in") {
    const vals = raw.replace(/^\(|\)$/g, "").split(",").map(parseValue)
    return (r) => vals.includes(r[col])
  }
  const v = parseValue(raw)
  if (op === "eq") return (r) => r[col] === v
  if (op === "neq") return (r) => r[col] !== v
  if (op === "is") return (r) => (r[col] ?? null) === v
  if (op === "lt") return (r) => r[col] != null && r[col] < v
  return (r) => r[col] != null && r[col] > v
}

export type FakeDb = {
  client: any
  tables: Record<string, Row[]>
  /** Run once, just before the next UPDATE on this table is applied. */
  beforeNextUpdate(table: string, fn: () => void): void
}

export function makeFakeDb(seed: Record<string, Row[]>): FakeDb {
  const tables: Record<string, Row[]> = {}
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }))
  const hooks: Record<string, (() => void) | undefined> = {}

  function builder(table: string) {
    const rows = () => (tables[table] ??= [])
    const preds: Pred[] = []
    let op: "select" | "update" | "insert" = "select"
    let patch: Row = {}
    let inserted: Row[] = []
    let returning = false
    let order: { col: string; asc: boolean } | null = null
    let limit: number | null = null

    function run(): Row[] {
      if (op === "insert") return inserted
      let hit = rows().filter((r) => preds.every((p) => p(r)))
      if (op === "update") {
        const hook = hooks[table]
        if (hook) {
          hooks[table] = undefined
          hook()
          hit = rows().filter((r) => preds.every((p) => p(r)))
        }
        for (const r of hit) Object.assign(r, patch)
      }
      if (order) {
        const { col, asc } = order
        hit = [...hit].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1))
      }
      if (limit !== null) hit = hit.slice(0, limit)
      return hit.map((r) => ({ ...r }))
    }

    const api: any = {
      select() { if (op !== "select") returning = true; return api },
      insert(v: Row | Row[]) {
        op = "insert"
        inserted = (Array.isArray(v) ? v : [v]).map((r) => {
          const row = {
            id: newId(),
            deleted_at: null,
            created_at: new Date().toISOString(),
            ...(table === "coach_tasks" ? { status: "open", completed_at: null } : {}),
            ...r,
          }
          rows().push(row)
          return { ...row }
        })
        return api
      },
      update(v: Row) { op = "update"; patch = v; return api },
      eq(c: string, v: any) { preds.push((r) => r[c] === v); return api },
      neq(c: string, v: any) { preds.push((r) => r[c] !== v); return api },
      in(c: string, vs: any[]) { preds.push((r) => vs.includes(r[c])); return api },
      is(c: string, v: any) { preds.push((r) => (r[c] ?? null) === v); return api },
      lt(c: string, v: any) { preds.push((r) => r[c] != null && r[c] < v); return api },
      or(expr: string) {
        const terms = splitTop(expr).map(orTerm)
        preds.push((r) => terms.some((t) => t(r)))
        return api
      },
      order(col: string, o: { ascending?: boolean } = {}) { order = { col, asc: o.ascending !== false }; return api },
      limit(n: number) { limit = n; return api },
      maybeSingle() { return Promise.resolve({ data: run()[0] ?? null, error: null }) },
      single() {
        const r = run()[0]
        return Promise.resolve(r ? { data: r, error: null } : { data: null, error: { message: "no rows" } })
      },
      then(resolve: (v: any) => unknown, reject?: (e: any) => unknown) {
        try {
          const data = run()
          return Promise.resolve(resolve({ data: op === "select" || returning ? data : null, error: null }))
        } catch (e) {
          return reject ? Promise.resolve(reject(e)) : Promise.reject(e)
        }
      },
    }
    return api
  }

  return {
    client: { from: (t: string) => builder(t) },
    tables,
    beforeNextUpdate(table, fn) { hooks[table] = fn },
  }
}
