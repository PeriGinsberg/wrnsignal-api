// app/api/jobfit/extractJobSignalsLLM.ts
//
// Stage-1 shadow JD extractor: ONE structured Opus 4.8 call per JD returning the
// approved schema (requirement_units + scalars). Caching + fail-open live through
// extractionCache.getExtraction; the prompt/schema live in jdExtractionPrompt.
//
// SHADOW MODE: nothing in the scoring path imports this. The shadow runner and
// the dry-run script call it; results are compared against regex extractJobSignals.

import {
  EXTRACTION_MODEL,
  EXTRACTION_PROMPT_VERSION,
  getExtraction,
  type ExtractionCache,
  type ExtractionResolveSource,
} from "./extractionCache"
import {
  EXTRACTION_SYSTEM_PROMPT,
  EXTRACTION_JSON_SCHEMA,
  buildExtractionUserPrompt,
  type LLMJobExtraction,
} from "./jdExtractionPrompt"

const MAX_TOKENS = 16000

function parseExtraction(rawText: string): LLMJobExtraction | null {
  // Structured outputs return schema-valid JSON as text; strip any stray fences
  // defensively (cf. semanticRelevance.parseVerdict / bulletGeneratorV5).
  const t = String.fromCharCode(96)
  const fence = t + t + t
  const stripped = rawText.split(fence + "json").join("").split(fence).join("").trim()
  const a = stripped.indexOf("{")
  const b = stripped.lastIndexOf("}")
  if (a === -1 || b === -1) return null
  let obj: any
  try {
    obj = JSON.parse(stripped.slice(a, b + 1))
  } catch {
    return null
  }
  if (!obj || !Array.isArray(obj.requirement_units) || typeof obj.scalars !== "object" || obj.scalars == null) {
    return null
  }
  return obj as LLMJobExtraction
}

// Usage/latency metadata emitted per live call (for the shadow runner's cost
// reporting). Not emitted on cache hits — those cost nothing.
export type ExtractionCallMeta = {
  input_tokens: number
  output_tokens: number // includes adaptive-thinking tokens
  stop_reason: string | null
  latency_ms: number
}

// Live Opus 4.8 call. FAIL-OPEN: returns null on missing key / HTTP error /
// refusal / truncation / unparseable output. Adaptive thinking + effort:high;
// structured output via output_config.format json_schema.
export async function callExtractionLive(
  args: { jdText: string; jobTitle?: string },
  onMeta?: (meta: ExtractionCallMeta) => void
): Promise<LLMJobExtraction | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  const t0 = Date.now()
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: EXTRACTION_MODEL,
        max_tokens: MAX_TOKENS,
        thinking: { type: "adaptive" },
        output_config: {
          effort: "high",
          format: { type: "json_schema", schema: EXTRACTION_JSON_SCHEMA },
        },
        system: EXTRACTION_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: buildExtractionUserPrompt({ jobText: args.jdText, userJobTitle: args.jobTitle }),
          },
        ],
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      console.error(`[extractJobSignalsLLM] http ${res.status} ${body.slice(0, 200)}`)
      return null
    }
    const json: any = await res.json()
    onMeta?.({
      input_tokens: Number(json?.usage?.input_tokens ?? 0),
      output_tokens: Number(json?.usage?.output_tokens ?? 0),
      stop_reason: json?.stop_reason ?? null,
      latency_ms: Date.now() - t0,
    })
    if (json?.stop_reason === "refusal") {
      console.error("[extractJobSignalsLLM] refusal")
      return null
    }
    const rawText = (json?.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => String(b.text ?? ""))
      .join("")
    const parsed = parseExtraction(rawText)
    if (!parsed) {
      console.error(
        `[extractJobSignalsLLM] unparseable (stop_reason=${json?.stop_reason}); snippet: ${rawText.slice(0, 200)}`
      )
    }
    return parsed
  } catch (err: any) {
    console.error("[extractJobSignalsLLM] error:", err?.message || String(err))
    return null
  }
}

// Cache-first shadow extractor. Frozen cache + allowLive:false → deterministic,
// no live calls. Returns null on any failure so the runner falls back to regex.
export async function extractJobSignalsLLM(
  jobText: string,
  opts: {
    userJobTitle?: string
    cache: ExtractionCache
    allowLive: boolean
    onResolve?: (info: { key: string; source: ExtractionResolveSource }) => void
    onMeta?: (meta: ExtractionCallMeta) => void
  }
): Promise<LLMJobExtraction | null> {
  return getExtraction<LLMJobExtraction>(
    opts.cache,
    { jdText: jobText, jobTitle: opts.userJobTitle },
    {
      allowLive: opts.allowLive,
      model: EXTRACTION_MODEL,
      promptVersion: EXTRACTION_PROMPT_VERSION,
      callLive: (a) => callExtractionLive(a, opts.onMeta),
      onResolve: opts.onResolve,
    }
  )
}
