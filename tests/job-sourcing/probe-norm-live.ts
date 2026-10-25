/** Read-only: call ingest_norm_text on the live database and compare with the TS mirror. */
import { createClient } from "@supabase/supabase-js"
import { normText } from "../../lib/ingest/fingerprint"
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const CASES = ["Point​72", "Ana­lyst", "Ardagh​​ Group", "﻿Macy's, Inc.", "Financial Crime Training Specialist‌", "plain text"]
;(async () => {
  let ok = true
  for (const c of CASES) {
    const { data, error } = await sb.rpc("ingest_norm_text", { v: c })
    if (error) { console.log(`rpc error: ${error.message}`); process.exit(1) }
    const same = data === normText(c)
    ok &&= same
    console.log(`${JSON.stringify(c).padEnd(48)} sql=${JSON.stringify(data).padEnd(40)} ts=${JSON.stringify(normText(c))} ${same ? "" : "MISMATCH"}`)
  }
  console.log(ok ? "SQL and TS agree on every case" : "DISAGREEMENT")
})()
