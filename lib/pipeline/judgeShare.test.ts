// Run: npx tsx lib/pipeline/judgeShare.test.ts
//
// The match step's first pass gives every client a share of the night's judging
// cap. 2026-11-05 on prod, in client id order: one new client's backlog took the
// rest of the cap and the four clients after it got none.

import { shareLimit } from "./tick"

let failures = 0
function ok(label: string, cond: boolean, detail = "") {
  if (!cond) { failures++; console.error(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`) }
  else console.log(`  ok    ${label}`)
}

/** The share pass, then the in-order pass, over each client's new postings. */
function night(cap: number, need: number[]) {
  const got = need.map(() => 0)
  let remaining = cap
  need.forEach((n, i) => { const t = Math.min(n, shareLimit(remaining, need.length - i)); got[i] += t; remaining -= t })
  need.forEach((n, i) => { const t = Math.min(n - got[i], remaining); got[i] += t; remaining -= t })
  return { got, remaining }
}

ok("even split", shareLimit(4000, 4) === 1000)
ok("rounds down", shareLimit(10, 3) === 3)
ok("nothing left", shareLimit(0, 5) === 0 && shareLimit(-3, 5) === 0)
ok("no clients left", shareLimit(100, 0) === 0)

// Last night's new postings by client, in id order (Maleri 8th, Daniel Etra last).
const need = [138, 244, 512, 315, 190, 448, 517, 1815, 61, 227, 212, 756]
const { got, remaining } = night(4000, need)
ok("every client is judged", got.every((g) => g > 0), got.join(","))
ok("the whole cap is used", remaining === 0)
ok("small clients get everything new", [0, 1, 4, 8].every((i) => got[i] === need[i]), got.join(","))
ok("the last client gets a real share", got[11] >= 300, String(got[11]))

const light = night(4000, [10, 20, 30])
ok("a light night judges everything", light.got.join(",") === "10,20,30" && light.remaining === 3940)

console.log(failures ? `\n${failures} failed` : "\nall passed")
if (failures) process.exit(1)
