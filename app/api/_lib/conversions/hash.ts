// app/api/_lib/conversions/hash.ts
//
// Crypto helpers for Conversion API user-data hashing and fbc synthesis.
// All providers (Meta, TikTok, Google, GA4) use hex SHA-256 of lowercased
// trimmed email as their match key.

import { createHash } from "node:crypto"

export function sha256Lower(input: string): string {
  if (!input) return ""
  return createHash("sha256")
    .update(input.trim().toLowerCase())
    .digest("hex")
}

// Meta accepts either the real _fbc cookie (set by its pixel library when
// fbclid lands in the URL) or a synthesized fallback of the form
// `fb.1.<creation_timestamp_ms>.<fbclid>`. Real cookie wins when present.
// We use current event time as the timestamp because we do not persist
// the original ad-click time — this is Meta's documented fallback.
export function resolveFbc(
  fbcCookie: string,
  fbclid: string,
  eventTimeMs: number
): string {
  if (fbcCookie) return fbcCookie
  if (!fbclid) return ""
  return `fb.1.${eventTimeMs}.${fbclid}`
}
