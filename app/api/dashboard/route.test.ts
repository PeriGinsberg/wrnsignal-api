#!/usr/bin/env tsx
// The analytics dashboard gate.
// Run: npx tsx app/api/dashboard/route.test.ts
//
// This page shipped with no auth at all: GET() took no request and checked
// nothing. The exposure was limited (its data loader is paused, and the anon
// role has no table grants in production), but an internal page reachable by
// path is still an internal page reachable by path.
//
// The happy path is pinned here because it cannot be proven by curling a server
// that has no token configured — where every request correctly 404s, including
// the one that should work.

import { GET } from "./route"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}`) }
}

const TOKEN = "test-token-abcdef123456"
const call = (url: string, headers: Record<string, string> = {}) =>
  GET(new Request(url, { headers }) as any)

async function main() {
  const original = process.env.ANALYTICS_DASHBOARD_TOKEN

  try {
    // FAILS CLOSED: no secret configured means the page does not exist, so a
    // deploy that forgets the env var is a missing page rather than an open one.
    delete process.env.ANALYTICS_DASHBOARD_TOKEN
    ok("unset token: no key is 404", (await call("https://x.test/api/dashboard")).status === 404)
    ok("unset token: even a plausible key is 404",
      (await call(`https://x.test/api/dashboard?key=${TOKEN}`)).status === 404)

    process.env.ANALYTICS_DASHBOARD_TOKEN = TOKEN
    ok("no key is 404", (await call("https://x.test/api/dashboard")).status === 404)
    ok("wrong key is 404", (await call("https://x.test/api/dashboard?key=nope")).status === 404)
    ok("a prefix of the token is 404", (await call(`https://x.test/api/dashboard?key=${TOKEN.slice(0, 8)}`)).status === 404)
    ok("empty key is 404", (await call("https://x.test/api/dashboard?key=")).status === 404)

    const viaQuery = await call(`https://x.test/api/dashboard?key=${TOKEN}`)
    ok("the right key in the query string serves the page", viaQuery.status === 200)
    ok("...as HTML", (viaQuery.headers.get("content-type") ?? "").includes("text/html"))
    ok("...uncacheable, because the URL carries the secret",
      (viaQuery.headers.get("cache-control") ?? "").includes("no-store"))
    ok("...and not indexable", (viaQuery.headers.get("x-robots-tag") ?? "").includes("noindex"))
    ok("...and not frameable", viaQuery.headers.get("x-frame-options") === "DENY")

    const viaHeader = await call("https://x.test/api/dashboard", { authorization: `Bearer ${TOKEN}` })
    ok("the right key as a Bearer header also serves the page", viaHeader.status === 200)

    ok("a 404 says nothing about the page existing",
      (await (await call("https://x.test/api/dashboard")).text()) === "Not found")
  } finally {
    if (original === undefined) delete process.env.ANALYTICS_DASHBOARD_TOKEN
    else process.env.ANALYTICS_DASHBOARD_TOKEN = original
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
