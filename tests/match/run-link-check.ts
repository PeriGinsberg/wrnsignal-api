/**
 * The nightly apply-link check, run by hand (lib/match/linkCheck.ts).
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     NODE_OPTIONS=--use-system-ca npx tsx tests/match/run-link-check.ts [--client <id>] [--top 30] [--prod]
 *
 * Flags:
 *   --client id   one client's queue only (default: every active client)
 *   --top N       queue ranks checked, default 30
 *   --dry-run     check and print, write nothing
 *   --prod        required to write to prod
 */

import { createClient } from "@supabase/supabase-js"
import { runLinkCheck } from "../../lib/match/linkCheck"

const PROD_REF = "ejhnokcnahauvrcbcmic"
const URL_ = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_ || !KEY) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment"); process.exit(1) }
const arg = (n: string) => { const i = process.argv.indexOf("--" + n); const v = process.argv[i + 1]; return i >= 0 && v && !v.startsWith("--") ? v : undefined }
const dryRun = process.argv.includes("--dry-run")
if (new URL(URL_).hostname.startsWith(PROD_REF) && !dryRun && !process.argv.includes("--prod")) {
  console.error(`Refusing to write to prod (${PROD_REF}) without --prod.`); process.exit(1)
}
const sb = createClient(URL_, KEY, { auth: { persistSession: false } })

;(async () => {
  const res = await runLinkCheck(sb, { top: Number(arg("top") ?? 30), clientProfileId: arg("client"), dryRun })
  console.log(`${dryRun ? "[dry run] " : ""}clients ${res.clients}, postings ${res.postings}, links ${res.links}: open ${res.open}, closed ${res.closed}, unknown ${res.unknown}`)
  for (const r of res.unknownRows) console.log(`  unknown ${r.company} | ${r.title}: ${r.evidence}\n    ${r.url}`)
  for (const r of res.closedRows) console.log(`  CLOSED ${r.company} | ${r.title}\n    ${r.url}\n    "${r.evidence}"`)
})().catch((e) => { console.error(e); process.exit(1) })
