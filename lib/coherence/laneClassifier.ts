// lib/coherence/laneClassifier.ts
//
// Resume-coherence detector — per-block lane classifier. One Haiku call
// classifies EVERY role-block of one resume into a lane (independent per block).
//
// Ported from the validated scaffolding (tests/concentration/dedup-audit.ts)
// with the Anthropic call switched from the SDK to the REST `fetch` pattern the
// rest of this codebase uses (see app/api/_lib/inferProfileOverridesFromResume.ts)
// so no new dependency is introduced. Fails OPEN: any error / missing key /
// malformed response → {} (no classifications), which the metric treats as
// unscorable and the orchestrator turns into a null coherence result.

import { LANES, LANE_IDS } from "@/lib/laneTaxonomy"
import type { Block } from "./resumeSegmentation"

const MODEL = "claude-haiku-4-5-20251001"
const MAX_TOKENS = 800

/** { [blockIndex]: laneId } — blocks the model couldn't place are absent. */
export type LaneByIndex = Record<number, string>

function renderTaxonomy(): string {
  return LANES.map((l) =>
    l.id === "other"
      ? `- ${l.id} (${l.label}) — anything no other lane fits`
      : `- ${l.id} (${l.label}): ${l.subLanes.map((s) => s.label).join(", ")}`,
  ).join("\n")
}

const SYSTEM_PROMPT = `You classify each WORK-EXPERIENCE BLOCK from one candidate's resume into one of 12 career lanes. Each block is a single role (a title line plus its bullets).

Rules:
- Classify each block INDEPENDENTLY, by the work actually described in THAT block — ignore the other blocks and any overall "theme" of the resume.
- Choose the BEST single lane per block from the strongest signal in the title + bullets.
- Use 'other' ONLY when no listed lane is a meaningful fit. Do NOT use 'other' as a soft default for a sparse block — pick the closest lane and lower confidence instead.
- confidence is your own certainty: high | medium | low.

Return JSON ONLY (no markdown fences): a JSON array, one object per block, in the SAME order as given:
[{"block_index": 0, "lane": "<lane_id>", "confidence": "high|medium|low"}, ...]

TAXONOMY (use these exact lane_id strings):
${renderTaxonomy()}`

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const URL = /https?:\/\/\S+/g
const PHONE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/g
const anon = (s: string) =>
  (s || "").replace(EMAIL, "[EMAIL]").replace(URL, "[URL]").replace(PHONE, "[PHONE]")

function buildUserPrompt(blocks: Block[]): string {
  const p: string[] = [
    `Candidate resume — ${blocks.length} experience block(s). Classify each.`,
    "",
  ]
  blocks.forEach((b, i) => {
    p.push(`[block ${i}]`, `title: ${anon(b.title_line).slice(0, 200)}`)
    if (b.bullets.length) {
      p.push("bullets:")
      for (const bl of b.bullets.slice(0, 12)) p.push(`- ${anon(bl).slice(0, 240)}`)
    } else {
      p.push("bullets: (none)")
    }
    p.push("")
  })
  p.push("Return the JSON array only.")
  return p.join("\n")
}

function parseClassification(raw: string, nBlocks: number): LaneByIndex | null {
  let t = (raw || "").trim()
  const fence = t.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i)
  if (fence) t = fence[1].trim()
  const arr = t.match(/\[[\s\S]*\]/)
  if (arr) t = arr[0]
  let parsed: unknown
  try {
    parsed = JSON.parse(t)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null
  const out: LaneByIndex = {}
  for (const e of parsed) {
    if (!e || typeof e !== "object") continue
    const idx = Number((e as { block_index?: unknown }).block_index)
    if (!Number.isInteger(idx) || idx < 0 || idx >= nBlocks) continue
    const lane = (e as { lane?: unknown }).lane
    out[idx] = typeof lane === "string" && LANE_IDS.includes(lane) ? lane : "other"
  }
  return out
}

/** Classify all blocks of one resume in a single Haiku call. Fails open → {}. */
export async function classifyBlocks(blocks: Block[]): Promise<LaneByIndex> {
  if (blocks.length === 0) return {}
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn("[coherence] ANTHROPIC_API_KEY missing — skipping lane classification")
    return {}
  }
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(blocks) }],
      }),
    })
    if (!res.ok) {
      const errBody = await res.text().catch(() => "")
      console.error("[coherence] Haiku API error:", res.status, errBody.slice(0, 200))
      return {}
    }
    const json = await res.json()
    const rawText = (json.content ?? [])
      .filter((b: { type?: string }) => b.type === "text")
      .map((b: { text?: string }) => String(b.text ?? ""))
      .join("")
    return parseClassification(rawText, blocks.length) ?? {}
  } catch (err) {
    console.error("[coherence] classifyBlocks failed:", (err as Error)?.message || String(err))
    return {}
  }
}
