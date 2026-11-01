// Run: npx tsx lib/pipeline/judgeCap.test.ts
//
// The one-night judgment cap (tick.ts JUDGE_CAP_BY_NIGHT): 9,000 on the night
// of 2026-11-02 only, the standing cap on every other night.

import { CAPS, judgeCapFor } from "./tick"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

ok("the standing cap is 4,000", CAPS.judgments === 4000 || !!process.env.PIPELINE_JUDGE_CAP)
ok("2026-11-02 runs at 9,000", judgeCapFor("2026-11-02") === 9000)
ok("2026-11-01 was the standing cap", judgeCapFor("2026-11-01") === CAPS.judgments)
ok("2026-11-03 is back on the standing cap", judgeCapFor("2026-11-03") === CAPS.judgments)

console.log(failures ? `\n${failures} failure(s)` : "\nall passed")
if (failures) process.exit(1)
