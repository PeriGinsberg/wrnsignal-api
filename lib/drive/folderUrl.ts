// lib/drive/folderUrl.ts
// Turning a pasted Google Drive folder link into a folder id.
//
// Pure, because this is the step a coach performs by hand and therefore the
// step most likely to receive something unexpected: a file link instead of a
// folder link, a shortened link, a link to someone's My Drive, or the whole
// browser tab title. Every one of those has to produce a sentence a coach can
// act on rather than a stack trace.
//
// See docs/Features/networking-plan-delivery-frd.md.

export type FolderUrlResult = { id: string } | { error: string }

// A Drive id is an opaque string; these are the characters Google actually
// uses. Bounded so a paragraph of pasted text cannot masquerade as an id.
const ID = /^[A-Za-z0-9_-]{10,200}$/

export function parseDriveFolderUrl(raw: unknown): FolderUrlResult {
  const s = typeof raw === "string" ? raw.trim() : ""
  if (!s) return { error: "Paste the link to the client's Networking folder in Drive." }

  // A bare id, which is what someone pastes when they copied from the address
  // bar of a folder they had already opened in a previous session.
  if (ID.test(s)) return { id: s }

  let u: URL
  try {
    u = new URL(s.includes("://") ? s : `https://${s}`)
  } catch {
    return { error: "That does not look like a Drive folder link." }
  }

  if (!/(^|\.)google\.com$/.test(u.hostname)) {
    return { error: "That does not look like a Google Drive link." }
  }

  // The folder form: /drive/folders/<id>, with or without a /u/0 prefix and
  // with or without anything after it.
  const parts = u.pathname.split("/").filter(Boolean)
  const at = parts.indexOf("folders")
  if (at >= 0 && parts[at + 1]) {
    const id = parts[at + 1]
    return ID.test(id) ? { id } : { error: "That folder link looks incomplete." }
  }

  // Common wrong-thing-pasted cases, each worth its own sentence because each
  // has a different fix.
  if (parts.includes("file")) {
    return { error: "That is a link to a file, not a folder. Open the folder and copy the link from there." }
  }
  if (u.pathname.startsWith("/drive/u/") && parts.length <= 3) {
    return { error: "That is a link to Drive itself, not to a folder. Open the client's Networking folder first." }
  }
  if (u.hostname === "docs.google.com") {
    return { error: "That is a link to a document, not a folder." }
  }

  return { error: "That does not look like a Drive folder link." }
}

/** The canonical URL for a folder id, for storing next to it. */
export function driveFolderUrl(id: string): string {
  return `https://drive.google.com/drive/folders/${id}`
}

/** The canonical URL for a file id, which is what the library entry points at. */
export function driveFileUrl(id: string): string {
  return `https://drive.google.com/file/d/${id}/view`
}
