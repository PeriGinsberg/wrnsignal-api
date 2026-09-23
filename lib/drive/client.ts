// lib/drive/client.ts
// Google Drive, over plain fetch with a service-account JWT.
//
// No `googleapis` dependency, deliberately: this workflow needs five calls
// (find, create folder, upload, update, share), and the Google Ads integration
// already established that a hand-rolled OAuth exchange plus fetch is how this
// codebase talks to Google. The package would add tens of megabytes to a
// deployment that is already carrying Chromium.
//
// EVERY CALL PASSES supportsAllDrives. Files live in a Shared Drive, and a
// Drive request without that flag cannot see them: the failure mode is a 404 on
// a file that plainly exists, which is a miserable thing to debug. It is set in
// one place here so no call site can forget it.
//
// See docs/Features/networking-plan-delivery-frd.md.

import { createSign } from "node:crypto"

const TOKEN_URL = "https://oauth2.googleapis.com/token"
const API = "https://www.googleapis.com/drive/v3"
const UPLOAD = "https://www.googleapis.com/upload/drive/v3"
const SCOPE = "https://www.googleapis.com/auth/drive"

export class DriveError extends Error {
  status: number
  reason: string
  constructor(message: string, status: number, reason = "") {
    super(message)
    this.status = status
    this.reason = reason
  }
}

/** Env, read lazily so an unconfigured deploy fails at use rather than import. */
function env() {
  const email = process.env.GOOGLE_DRIVE_SA_EMAIL
  const key = process.env.GOOGLE_DRIVE_SA_PRIVATE_KEY
  const driveId = process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID
  const missing = [
    !email && "GOOGLE_DRIVE_SA_EMAIL",
    !key && "GOOGLE_DRIVE_SA_PRIVATE_KEY",
    !driveId && "GOOGLE_DRIVE_SHARED_DRIVE_ID",
  ].filter(Boolean)
  if (missing.length) throw new DriveError(`Drive is not configured: ${missing.join(", ")} missing.`, 500, "unconfigured")
  // Vercel env vars cannot hold real newlines, so the key is stored with \n
  // escaped and unescaped here. A key that still has literal backslash-n will
  // fail signing with an unhelpful OpenSSL error, so normalise both forms.
  return { email: email!, key: key!.replace(/\\n/g, "\n"), driveId: driveId! }
}

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

/**
 * A service-account access token.
 *
 * Minted per call rather than cached: the Google Ads integration made the same
 * choice for the same reason, which is that a stateless function cannot share a
 * cache between invocations without adding a store, and ~200ms on a job that
 * also renders a PDF is not the bottleneck.
 */
async function accessToken(): Promise<string> {
  const { email, key } = env()
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const claim = b64url(JSON.stringify({
    iss: email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }))
  const signer = createSign("RSA-SHA256")
  signer.update(`${header}.${claim}`)
  let signature: string
  try {
    signature = b64url(signer.sign(key))
  } catch (e: any) {
    throw new DriveError(`Could not sign with the service-account key: ${e?.message ?? e}`, 500, "bad_key")
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claim}.${signature}`,
    }),
  })
  const json: any = await res.json().catch(() => ({}))
  if (!res.ok || !json.access_token) {
    throw new DriveError(`Drive auth failed: ${json.error_description || json.error || res.status}`, res.status, "auth")
  }
  return json.access_token as string
}

/** Shared-drive parameters every request needs. */
const DRIVE_PARAMS = { supportsAllDrives: "true", includeItemsFromAllDrives: "true" }

async function call(path: string, init: RequestInit & { params?: Record<string, string> } = {}) {
  const token = await accessToken()
  const url = new URL(`${API}${path}`)
  for (const [k, v] of Object.entries({ ...DRIVE_PARAMS, ...(init.params ?? {}) })) url.searchParams.set(k, v)
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  })
  const text = await res.text()
  const json = text ? JSON.parse(text) : {}
  if (!res.ok) {
    const reason = json?.error?.errors?.[0]?.reason ?? ""
    throw new DriveError(json?.error?.message || `Drive ${res.status}`, res.status, reason)
  }
  return json
}

export type DriveFile = { id: string; name: string; mimeType: string; driveId?: string; trashed?: boolean; webViewLink?: string }

/** One file or folder's metadata, or null when the service account cannot see it. */
export async function getFile(id: string): Promise<DriveFile | null> {
  try {
    return await call(`/files/${encodeURIComponent(id)}`, {
      params: { fields: "id,name,mimeType,driveId,trashed,webViewLink" },
    })
  } catch (e) {
    if (e instanceof DriveError && e.status === 404) return null
    throw e
  }
}

/**
 * Confirm a pasted folder is one we can actually use: a folder, not trashed,
 * and inside OUR Shared Drive. The last check is the one that matters — a
 * folder in somebody's personal Drive will often be readable and is still the
 * wrong place to put client work, because the file would be owned by a person.
 */
export async function verifyFolder(id: string): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const { driveId } = env()
  const f = await getFile(id)
  if (!f) return { ok: false, error: "We cannot see that folder. Share it with the SIGNAL service account, or pick a folder inside the Shared Drive." }
  if (f.mimeType !== "application/vnd.google-apps.folder") return { ok: false, error: "That link points at a file, not a folder." }
  if (f.trashed) return { ok: false, error: "That folder is in the trash." }
  if (f.driveId !== driveId) return { ok: false, error: "That folder is not in the SIGNAL Shared Drive. Move it, or pick one inside it." }
  return { ok: true, name: f.name }
}

/** A child folder by exact name, or null. Used only when creating the path. */
export async function findChildFolder(parentId: string, name: string): Promise<DriveFile | null> {
  const q = [
    `'${parentId}' in parents`,
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
    `name = '${name.replace(/'/g, "\\'")}'`,
  ].join(" and ")
  const json = await call("/files", {
    params: { q, corpora: "drive", driveId: env().driveId, fields: "files(id,name,mimeType,driveId,trashed)", pageSize: "10" },
  })
  return json.files?.[0] ?? null
}

export async function createFolder(parentId: string, name: string): Promise<DriveFile> {
  return call("/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    params: { fields: "id,name,mimeType,driveId,webViewLink" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
  })
}

/** Find a child folder by name, creating it when absent. Idempotent. */
export async function ensureChildFolder(parentId: string, name: string): Promise<DriveFile> {
  return (await findChildFolder(parentId, name)) ?? (await createFolder(parentId, name))
}

/**
 * A file previously created by this workflow, found by the job id stamped on
 * it. This is the belt to the job row's braces: if an upload succeeded but the
 * response never reached us, the job row has no file id, and without this the
 * retry would create a second copy.
 */
export async function findByJobId(parentId: string, jobId: string): Promise<DriveFile | null> {
  const q = [
    `'${parentId}' in parents`,
    "trashed = false",
    `appProperties has { key = 'signal_job_id' and value = '${jobId}' }`,
  ].join(" and ")
  const json = await call("/files", {
    params: { q, corpora: "drive", driveId: env().driveId, fields: "files(id,name,mimeType,webViewLink)", pageSize: "10" },
  })
  return json.files?.[0] ?? null
}

/** Multipart upload: metadata + bytes in one request. */
async function upload(
  method: "POST" | "PATCH",
  path: string,
  metadata: Record<string, unknown>,
  bytes: Buffer,
): Promise<DriveFile> {
  const token = await accessToken()
  const boundary = `signal-${Date.now().toString(36)}`
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  const url = new URL(`${UPLOAD}${path}`)
  url.searchParams.set("uploadType", "multipart")
  url.searchParams.set("supportsAllDrives", "true")
  url.searchParams.set("fields", "id,name,mimeType,webViewLink")
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  })
  const text = await res.text()
  const json = text ? JSON.parse(text) : {}
  if (!res.ok) {
    const reason = json?.error?.errors?.[0]?.reason ?? ""
    throw new DriveError(json?.error?.message || `Drive upload ${res.status}`, res.status, reason)
  }
  return json
}

export async function createPdf(parentId: string, name: string, bytes: Buffer, jobId: string): Promise<DriveFile> {
  return upload("POST", "/files", {
    name,
    parents: [parentId],
    mimeType: "application/pdf",
    // The idempotency stamp findByJobId looks for.
    appProperties: { signal_job_id: jobId },
  }, bytes)
}

/**
 * Replace the CONTENTS of an existing file. This is what a re-run does, and it
 * is the whole reason the library link never breaks: Drive keeps the id and
 * adds a revision, so anyone holding the link sees the new plan.
 */
export async function updatePdf(fileId: string, name: string, bytes: Buffer): Promise<DriveFile> {
  return upload("PATCH", `/files/${encodeURIComponent(fileId)}`, { name }, bytes)
}

/**
 * Anyone with the link may view THIS FILE. Never the folder: a folder grant
 * would expose everything else stored beside the plan.
 */
export async function shareAnyoneWithLink(fileId: string): Promise<{ permissionId: string; role: string }> {
  const json = await call(`/files/${encodeURIComponent(fileId)}/permissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    params: { fields: "id,role" },
    body: JSON.stringify({ role: "reader", type: "anyone", allowFileDiscovery: false }),
  })

  // VERIFY WHAT WE ACTUALLY GRANTED, because asking is not the same as getting.
  // Drive RAISES a file permission to match access inherited from a parent and
  // refuses to lower it ("Cannot modify a permission on an item to be less than
  // the inherited access"). So if an ancestor folder is itself link-shared with
  // edit rights, a request for `reader` silently becomes `writer` or
  // `fileOrganizer`, and everyone holding the link can change or delete the
  // file. Reporting that as "shared, view only" would be a lie with teeth.
  const granted = String(json.role ?? "")
  return { permissionId: json.id as string, role: granted }
}

// Drive's roles, weakest first. "viewer or higher" is the test that matters:
// anything at or above reader means a client holding the link can open the plan,
// which is all the Share action is trying to achieve.
const ROLE_RANK: Record<string, number> = {
  reader: 1, commenter: 2, writer: 3, fileOrganizer: 4, organizer: 5, owner: 6,
}

export function isViewerOrHigher(role: string): boolean {
  return (ROLE_RANK[role] ?? 0) >= ROLE_RANK.reader
}

/**
 * The anyone-with-the-link permission on a file, INCLUDING one inherited from a
 * parent folder, or null when the link grants nothing.
 *
 * permissions.list reports inherited grants alongside direct ones, which is
 * what makes this answer the real question: can somebody holding this link open
 * the file, whatever the reason.
 */
export async function anyoneLinkPermission(fileId: string): Promise<{ id: string; role: string } | null> {
  const json = await call(`/files/${encodeURIComponent(fileId)}/permissions`, {
    params: { fields: "permissions(id,type,role,allowFileDiscovery)" },
  })
  const anyone = (json.permissions ?? []).find((p: any) => p.type === "anyone")
  return anyone ? { id: String(anyone.id), role: String(anyone.role) } : null
}

/** Remove a link grant. Ending a coaching relationship does NOT call this (a
 *  decided behaviour); it exists so a wrong share can be undone by hand. */
export async function unshare(fileId: string, permissionId: string): Promise<void> {
  await call(`/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}`, { method: "DELETE" })
}

/** True when a Drive failure is worth retrying rather than reporting. */
export function isRetryable(e: unknown): boolean {
  if (!(e instanceof DriveError)) return false
  if (e.status === 429 || e.status >= 500) return true
  return ["rateLimitExceeded", "userRateLimitExceeded", "backendError", "internalError"].includes(e.reason)
}

/** True when the domain or Shared Drive forbids link sharing, which is policy
 *  rather than breakage and must be reported to the coach as such. */
export function isSharingBlocked(e: unknown): boolean {
  if (!(e instanceof DriveError)) return false
  return e.status === 403 && !isRetryable(e)
}
