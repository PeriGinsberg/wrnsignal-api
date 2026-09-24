/**
 * Establish what the real location actually accepts, before anything is wired
 * to a coach-facing button.
 *
 *   GHL_API_KEY=... GHL_LOCATION_ID=... GHL_TEST_CONTACT_ID=... \
 *     NODE_OPTIONS=--use-system-ca npx tsx tests/ghl/probe.ts
 *
 * WHY THIS EXISTS. The working code in app/api/seat-create/route.ts sends
 * `Version: 2021-07-28`. Every current developer-docs page specifies
 * `Version: v3`. Both may be accepted. Rather than pick one and find out in
 * production, this asks each endpoint directly and prints what came back.
 *
 * SAFE BY DEFAULT. Reads only, unless --write is passed:
 *   no flag   lookup + version probes only, nothing is modified
 *   --write   also adds a note on GHL_TEST_CONTACT_ID
 *
 * IT NEVER ADDS THE TAG. The tag fires the workflow that emails the client;
 * probing it would send a real email to whoever the test contact is. Tag
 * behaviour has to be confirmed by hand, once, with somebody watching.
 */

import { ghlConfig, GhlError, ghlRequest } from "../../lib/ghl/client"
import {
  contactDisplayName,
  findContactByEmail,
  networkingPlanNoteText,
  parseContactLink,
  addContactNote,
} from "../../lib/ghl/contacts"

const arg = (n: string) => {
  const i = process.argv.indexOf("--" + n)
  const v = process.argv[i + 1]
  return i >= 0 && v && !v.startsWith("--") ? v : undefined
}
const WRITE = process.argv.includes("--write")
const EMAIL = arg("email") ?? process.env.GHL_TEST_CONTACT_EMAIL
const CONTACT_ID = arg("contact") ?? process.env.GHL_TEST_CONTACT_ID

const VERSIONS = ["2021-07-28", "v3"]

async function tryVersion(label: string, version: string, run: () => Promise<unknown>) {
  try {
    await run()
    console.log("    " + version.padEnd(12) + "OK")
    return true
  } catch (e: any) {
    const status = e instanceof GhlError ? e.status : null
    console.log("    " + version.padEnd(12) + "FAILED" + (status ? " (" + status + ")" : "") +
      "  " + String(e?.message ?? e).slice(0, 110))
    return false
  }
}

;(async () => {
  console.log("GHL probe")
  console.log("  location : " + (process.env.GHL_LOCATION_ID ?? "(GHL_LOCATION_ID unset)"))
  console.log("  token    : " + (process.env.GHL_API_KEY ? "set" : "UNSET"))
  console.log("  mode     : " + (WRITE ? "READ + WRITE (note)" : "READ ONLY"))
  console.log("  tag      : never probed, see the header\n")

  // ---- offline: the link parser needs no credentials
  console.log("parseContactLink")
  const cases: [string, string | null][] = [
    ["https://app.gohighlevel.com/v2/location/LOC123/contacts/detail/abc123DEF456ghi789", "abc123DEF456ghi789"],
    ["https://app.gohighlevel.com/location/LOC123/contacts/detail/abc123DEF456ghi789", "abc123DEF456ghi789"],
    ["abc123DEF456ghi789", "abc123DEF456ghi789"],
    ["https://app.gohighlevel.com/v2/location/LOC123/contacts/", null],
    ["https://example.com/nope", null],
    ["not a url", null],
    ["", null],
  ]
  let bad = 0
  for (const [input, want] of cases) {
    const got = parseContactLink(input)
    const ok = got === want
    if (!ok) bad++
    console.log("  " + (ok ? "ok  " : "FAIL") + "  " + JSON.stringify(input).slice(0, 62).padEnd(64) + "-> " + JSON.stringify(got))
  }
  console.log("  " + (bad === 0 ? "all parse cases pass" : bad + " FAILURES") + "\n")

  if (!process.env.GHL_API_KEY || !process.env.GHL_LOCATION_ID) {
    console.log("no credentials in the environment; stopping after the offline checks.")
    return
  }

  // ---- which Version does each endpoint accept?
  console.log("VERSION HEADER, per endpoint\n")

  console.log("  GET /contacts/search/duplicate")
  for (const v of VERSIONS) {
    if (!EMAIL) { console.log("    " + v.padEnd(12) + "skipped (no --email / GHL_TEST_CONTACT_EMAIL)"); continue }
    await tryVersion("lookup", v, () => findContactByEmail(EMAIL, ghlConfig({ version: v })))
  }

  console.log("\n  GET /contacts/{id}")
  for (const v of VERSIONS) {
    if (!CONTACT_ID) { console.log("    " + v.padEnd(12) + "skipped (no --contact / GHL_TEST_CONTACT_ID)"); continue }
    await tryVersion("get", v, () =>
      ghlRequest(`/contacts/${encodeURIComponent(CONTACT_ID)}`, { method: "GET" }, ghlConfig({ version: v })))
  }

  // ---- what the lookup actually returns, since the docs do not pin the shape
  if (EMAIL) {
    console.log("\nLOOKUP RESULT for " + JSON.stringify(EMAIL))
    try {
      const raw = await ghlRequest<any>(
        "/contacts/search/duplicate",
        { method: "GET", query: { locationId: process.env.GHL_LOCATION_ID, email: EMAIL } },
        ghlConfig(),
      )
      console.log("  status " + raw.status + ", attempts " + raw.attempts)
      console.log("  top-level keys: " + Object.keys(raw.data ?? {}).join(", "))
      console.log("  raw: " + JSON.stringify(raw.data).slice(0, 400))
      const c = await findContactByEmail(EMAIL, ghlConfig())
      console.log("  parsed -> " + (c ? c.id + "  " + contactDisplayName(c) : "no match"))
    } catch (e: any) {
      console.log("  FAILED: " + String(e?.message ?? e).slice(0, 200))
    }
  }

  // ---- writes, only when asked
  if (!WRITE) {
    console.log("\nread-only run complete. Re-run with --write to exercise the note.")
    return
  }
  if (!CONTACT_ID) {
    console.log("\n--write needs --contact <id> or GHL_TEST_CONTACT_ID.")
    return
  }

  console.log("\nWRITES against contact " + CONTACT_ID)
  try {
    const n = await addContactNote(CONTACT_ID, networkingPlanNoteText() + " [probe]", ghlConfig())
    console.log("  note         : OK " + (n.id ?? "(no id returned)"))
  } catch (e: any) {
    console.log("  note         : FAILED " + String(e?.message ?? e).slice(0, 160))
  }
  console.log("\n  tag          : deliberately not probed - it emails the client.")
})().catch((e) => {
  console.error("\nprobe failed: " + (e?.message ?? e))
  process.exit(1)
})
