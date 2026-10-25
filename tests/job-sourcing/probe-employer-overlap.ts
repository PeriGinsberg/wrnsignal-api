/** Read-only: which serpapi employers also appear under another source, any title. */
import { readFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
import { normText } from "../../lib/ingest/fingerprint"
const env: Record<string, string> = {}
for (const l of readFileSync(join(__dirname, "..", "..", ".env.phase0"), "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const co = (s: string) => normText(s).replace(/\b(inc|llc|llp|ltd|corp|corporation|co|company|plc|group|the|us|usa|na|holdings)\b/g, " ").replace(/\s+/g, " ").trim()
const similar = (x: string, y: string) => { if (!x || !y) return false; if (x === y) return true; const [s, l] = x.length <= y.length ? [x, y] : [y, x]; return l.startsWith(s + " ") || l.replace(/ /g, "") === s.replace(/ /g, "") }
;(async () => {
  const all: any[] = []
  for (let f = 0; ; f += 1000) { const { data } = await sb.from("postings").select("source,company,title").range(f, f + 999); all.push(...(data || [])); if (!data || data.length < 1000) break }
  const serp = [...new Set(all.filter((r) => r.source === "serpapi").map((r) => co(r.company)))]
  const other = new Map<string, Set<string>>()
  for (const r of all.filter((r) => r.source !== "serpapi")) { const k = co(r.company); if (!other.has(k)) other.set(k, new Set()); other.get(k)!.add(r.source) }
  console.log(`serpapi employers ${serp.length}; other-source employers ${other.size}`)
  for (const s of serp) for (const [o, srcs] of other) if (similar(s, o)) {
    const titles = all.filter((r) => r.source === "serpapi" && co(r.company) === s).map((r) => r.title)
    const n = all.filter((r) => r.source !== "serpapi" && co(r.company) === o).length
    console.log(`  ${s}  ~  ${o} [${[...srcs].join(",")}, ${n} postings]  serpapi titles: ${titles.join(" ; ")}`)
  }
})()
