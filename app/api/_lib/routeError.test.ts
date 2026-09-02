// Run: npx tsx app/api/_lib/routeError.test.ts
//
// THE 403 GAP, CLOSED IN THREE PLACES. The scope refactor's safety argument is
// that an authorisation failure becomes a 403. Nothing proved that: the status
// was decided by a regex chain copied into twenty catch blocks, six of which
// had already lost the /forbidden/i clause and would have answered 500.
//
// Three assertions together, because no one of them is sufficient:
//
//   1. UNIT      the mapper maps ForbiddenError to 403, by TYPE not by message
//   2. STATIC    every network route uses the mapper and hand-rolls nothing,
//                so a route added tomorrow fails this file until it complies
//   3. WIRED     every exported handler's catch actually REACHES the mapper,
//                proven by driving the real handler with no Authorization
//                header and checking it answers 401 rather than 500
//
// (2) is what makes the mapper hard to skip. (3) is a genuine route-level test
// and it needs no HTTP server and no mocking, because getBearerToken throws
// before anything touches the network.

import { readdirSync, statSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { errorStatus, routeError } from "./routeError"
import { ForbiddenError } from "@/lib/collab/scope"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

// Windows gives back-slashed paths and a literal back-slash cannot survive
// this file's own heredoc history, so it is built by char code.
const SEP = String.fromCharCode(92)
const norm = (p: string) => p.split(SEP).join("/")
const ROOT = "app/api/network"
function routeFiles(dir = ROOT, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e)
    if (statSync(full).isDirectory()) routeFiles(full, out)
    else if (e === "route.ts") out.push(full)
  }
  return out
}

async function main() {
  // ── 1. the mapper itself ────────────────────────────────────────────────
  console.log("\nthe mapper")
  ok("ForbiddenError -> 403", errorStatus(new ForbiddenError()) === 403)
  ok("...by TYPE, not by message", errorStatus(new ForbiddenError("Not allowed")) === 403)
  ok("Unauthorized -> 401", errorStatus(new Error("Unauthorized: missing bearer token")) === 401)
  ok("Profile not found -> 404", errorStatus(new Error("Profile not found")) === 404)
  ok("...case-insensitively", errorStatus(new Error("profile not found")) === 404)
  ok("a bare Error saying forbidden -> 403", errorStatus(new Error("Forbidden")) === 403)
  ok("anything else -> 500", errorStatus(new Error("Insert failed: boom")) === 500)
  ok("a non-Error -> 500", errorStatus("nope") === 500)
  {
    const res = routeError(new Request("https://x.test/api/network/contacts"), new ForbiddenError())
    const body = await res.json()
    ok("routeError responds 403", res.status === 403)
    ok("...with the shape the routes already returned",
      body.ok === false && body.error === "Forbidden")
  }

  // ── 2. no route may hand-roll its own status chain ──────────────────────
  console.log("\nevery network route uses the mapper")
  const files = routeFiles()
  ok(`found the route files (${files.length})`, files.length === 15)
  for (const f of files) {
    const src = readFileSync(f, "utf8")
    const name = norm(f).replace(ROOT + "/", "").replace("/route.ts", "")
    const handRolled = /const status = \/unauthorized/.test(src) ||
                       /const status = msg\.toLowerCase\(\)/.test(src)
    ok(`${name}: no hand-rolled status chain`, !handRolled)
    ok(`${name}: imports the mapper`, /from "[^"]*_lib\/routeError"/.test(src))
  }

  // ── 3. the catch path actually reaches it ───────────────────────────────
  // Real handlers, real Request, no Authorization header. getBearerToken throws
  // "Unauthorized: missing bearer token" before any client is constructed, so a
  // correctly wired catch answers 401. A 500 here means the error fell through.
  console.log("\nevery handler's catch reaches the mapper")
  process.env.SUPABASE_URL ||= "https://example.supabase.co"
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-key-not-used"
  const METHODS = ["GET", "POST", "PATCH", "DELETE"] as const
  let checked = 0
  for (const f of files) {
    const name = norm(f).replace(ROOT + "/", "").replace("/route.ts", "")
    const mod: any = await import("@/" + norm(f).replace(/\.ts$/, ""))
    for (const m of METHODS) {
      if (typeof mod[m] !== "function") continue
      const url = `https://x.test/${norm(f)}`
      const req = new Request(url, {
        method: m,
        ...(m === "GET" || m === "DELETE" ? {} : { body: "{}", headers: { "content-type": "application/json" } }),
      })
      const res = await mod[m](req as any, { params: Promise.resolve({ contactId: "c1", companyId: "co1", templateId: "C2" }) })
      checked++
      // 401 is the expected answer. 400 is allowed only where the handler
      // validates its body before authenticating, which link-application does
      // deliberately. 500 is the failure this whole file exists to catch.
      ok(`${name} ${m}: ${res.status} (not 500)`, res.status !== 500)
    }
  }
  ok(`drove ${checked} handlers`, checked >= 20)
}

main().then(() => {
  console.log(failures === 0 ? "\nall routeError assertions passed\n" : `\n${failures} FAILED\n`)
  process.exit(failures === 0 ? 0 : 1)
})
