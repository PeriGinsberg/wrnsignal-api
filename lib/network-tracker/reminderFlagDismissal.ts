// lib/network-tracker/reminderFlagDismissal.ts
//
// WHICH FOLLOW-UP FLAGS THIS VIEWER HAS WAVED AWAY.
//
// The flag sits at the top of the contact record when a reminder is due or
// overdue. Dismissing it must not fight the reminder engine: the engine
// recomputes next_due_at from the log and the stage, so a dismissal that simply
// hid the flag would have it back on the next render, and one that CLEARED the
// reminder would silently throw away a date the user chose.
//
// SO A DISMISSAL IS SCOPED TO ONE DUE DATE. The key is contact id plus the
// next_due_at it was raised for. Waving away "you were going to follow up on
// Aug 1" says nothing about the next reminder, which is a different question
// and gets asked again. That also means dismissals expire by themselves: once
// the date moves, the old key is unreachable.
//
// Client-side for the same reason the empty-company strip is (see
// stripDismissal): there is no server home for per-viewer UI state, and when
// coaches arrive a coach waving away a flag must not answer for the client.
// Every read and write is wrapped; localStorage throws outright in some
// privacy modes and a flag is not worth a white screen.

const KEY = "signal_net_reminder_flag_dismissed_v1"

type Store = Record<string, string[]>   // profileId -> "contactId|dueAt"[]

function read(): Store {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? (parsed as Store) : {}
  } catch {
    return {}
  }
}

function write(store: Store): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    // Full, blocked, or private mode. The flag simply comes back.
  }
}

/** contact + the exact due date the flag was raised for. */
export function flagKey(contactId: string, dueAt: string | null | undefined): string {
  return `${contactId}|${dueAt ?? ""}`
}

export function isFlagDismissed(profileId: string, contactId: string, dueAt: string | null | undefined): boolean {
  if (!profileId || !contactId || !dueAt) return false
  return (read()[profileId] ?? []).includes(flagKey(contactId, dueAt))
}

export function dismissFlag(profileId: string, contactId: string, dueAt: string | null | undefined): void {
  if (!profileId || !contactId || !dueAt) return
  const store = read()
  const next = new Set(store[profileId] ?? [])
  next.add(flagKey(contactId, dueAt))
  // A cap, because these accumulate one per reminder per contact and nothing
  // else prunes them: an old key is unreachable once the date moves, so the
  // oldest are always the safest to drop.
  store[profileId] = [...next].slice(-500)
  write(store)
}

/** Sign-out sweep, alongside the other per-viewer keys. */
export function clearAllFlagDismissals(): void {
  if (typeof window === "undefined") return
  try { window.localStorage.removeItem(KEY) } catch {}
}
