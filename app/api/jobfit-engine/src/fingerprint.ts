// src/fingerprint.ts
import crypto from "crypto"
import { EngineVersion, JobSignalsV1, ProfileSignalsV1 } from "./types"

export function normalizeText(s: string): string {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim()
}

/**
 * Fingerprint must be stable for identical inputs.
 * Uses:
 * - engine_version
 * - normalized job title
 * - normalized company
 * - normalized description
 * - profile_id
 * - resume_fingerprint
 */
export function generateFingerprint(engineVersion: EngineVersion, job: JobSignalsV1, profile: ProfileSignalsV1): string {
  const payload = [
    engineVersion,
    normalizeText(job.normalized.title),
    normalizeText(job.normalized.company),
    normalizeText(job.normalized.description),
    profile.profile_id,
    profile.resume_fingerprint,
  ].join("|")

  return crypto.createHash("sha256").update(payload).digest("hex")
}