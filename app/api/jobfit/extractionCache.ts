// app/api/jobfit/extractionCache.ts
//
// JD-extraction cache — generalizes the semanticRelevance verdictKey/VerdictCache
// pattern (semanticRelevance.ts) for the Stage-1 LLM JD extractor.
//
// Determinism controls (mirror the semantic layer):
//   - key = sha256(model | promptVersion | normalized JD text). A model bump OR
//     a prompt change re-freezes behind a reviewed diff.
//   - frozen cache file (local-only) read in the deterministic test suites with
//     allowLive:false → no live calls, byte-stable results, CI never hits the API.
//   - FAIL-OPEN to null: cache miss with allowLive:false, or any error/throw from
//     the live call → null. The caller falls back to regex extraction. A flaky
//     call can never corrupt the shadow comparison.
//
// This module is generic over the extraction payload (T) and takes the live-call
// function by injection, so it has zero dependency on the prompt/model/schema in
// extractJobSignalsLLM — exactly as semanticRelevance.getVerdict owns caching
// while callRelevanceLive owns the API shape.

import crypto from "crypto"
import { readFileSync, writeFileSync, existsSync } from "node:fs"

// Pinned model + prompt version. Both participate in the cache key so either a
// model swap or a prompt edit invalidates the frozen cache and forces a review.
export const EXTRACTION_MODEL = "claude-opus-4-8"
export const EXTRACTION_PROMPT_VERSION = "jd-extract-v2"

// The cached value is whatever the extractor returns. Kept opaque here so the
// cache stays decoupled from the schema in extractJobSignalsLLM.
export type ExtractionCache = Record<string, unknown>

// Stable normalization for the cache KEY only (collapse whitespace, trim, lower)
// so trivial whitespace variants of the same JD share a cache entry. The LLM
// itself still receives the original JD text — this is key-hashing only.
function normalizeForKey(jdText: string): string {
  return String(jdText || "").replace(/\s+/g, " ").trim().toLowerCase()
}

// Cache key — pinned to model AND prompt version (cf. semanticRelevance.verdictKey,
// which pins to model). U+241F (␟) unit separator matches the semantic layer.
export function extractionKey(
  jdText: string,
  model: string = EXTRACTION_MODEL,
  promptVersion: string = EXTRACTION_PROMPT_VERSION
): string {
  return crypto
    .createHash("sha256")
    .update(`${model}␟${promptVersion}␟${normalizeForKey(jdText)}`)
    .digest("hex")
}

// ── Frozen-cache file IO (local-only; cf. tests/.../lib/semantic-cache.ts) ─────

export function loadExtractionCache(path: string): ExtractionCache {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ExtractionCache
  } catch {
    return {}
  }
}

export function saveExtractionCache(path: string, cache: ExtractionCache): void {
  writeFileSync(path, JSON.stringify(cache, null, 2) + "\n", "utf8")
}

// Diagnostic for callers that want to log how each JD resolved.
export type ExtractionResolveSource = "cache" | "live" | "miss" | "error"

// Cache-first resolve. FAIL-OPEN to null on miss-without-live or any error.
// `callLive` is injected (the extractor supplies its own Opus 4.8 call), so this
// module never imports the prompt/model fetch. On a successful live result the
// cache is mutated in place (warm caching); persist it with saveExtractionCache.
export async function getExtraction<T>(
  cache: ExtractionCache,
  args: { jdText: string; jobTitle?: string },
  opts: {
    allowLive: boolean
    model?: string
    promptVersion?: string
    callLive?: (args: { jdText: string; jobTitle?: string }) => Promise<T | null>
    onResolve?: (info: { key: string; source: ExtractionResolveSource }) => void
  }
): Promise<T | null> {
  const key = extractionKey(args.jdText, opts.model, opts.promptVersion)

  const cached = cache[key]
  if (cached !== undefined) {
    opts.onResolve?.({ key, source: "cache" })
    return cached as T
  }

  if (!opts.allowLive || !opts.callLive) {
    opts.onResolve?.({ key, source: "miss" })
    return null
  }

  try {
    const live = await opts.callLive(args)
    if (live == null) {
      opts.onResolve?.({ key, source: "error" })
      return null
    }
    cache[key] = live
    opts.onResolve?.({ key, source: "live" })
    return live
  } catch {
    opts.onResolve?.({ key, source: "error" })
    return null
  }
}
