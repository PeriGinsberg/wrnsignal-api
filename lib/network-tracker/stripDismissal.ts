// lib/network-tracker/stripDismissal.ts
//
// WHICH EMPTY-COMPANY PROMPTS THIS VIEWER HAS WAVED AWAY.
//
// WHY NOT THE OLD HOME. The existing pattern for this kind of thing is
// network_client_profile.help_dismissed, a jsonb column. That table is being
// retired, and this step allows no schema changes, so a server home is not
// available. localStorage is, and the trade is worth stating rather than
// discovering:
//
//   per viewer   RIGHT, and it becomes more right when coaches arrive. A coach
//                dismissing "nobody at Globex yet" must not dismiss it for the
//                client, whose board it is and whose work it describes.
//   per device   WRONG but cheap. Dismiss on a laptop, see it again on a phone.
//                A prompt is not data, so re-showing it is a small cost.
//   persistent   DELIBERATE. sessionStorage would re-ask on every tab, which is
//                worse than never having offered to dismiss: a control that
//                does not stick reads as broken.
//
// SCOPED BY PROFILE ID so two accounts on one browser do not inherit each
// other's dismissals, which is the same reason signOut sweeps its keys.
//
// Every read and write is wrapped: localStorage throws outright in some
// privacy modes, and an empty-company prompt is not worth a white screen.

const KEY = "signal_net_empty_company_dismissed_v1"

type Store = Record<string, string[]> // profileId -> companyId[]

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
    // Full, blocked, or private mode. The prompt simply comes back.
  }
}

/** The set of company ids this viewer has dismissed on this device. */
export function dismissedFor(profileId: string): Set<string> {
  if (!profileId) return new Set()
  return new Set(read()[profileId] ?? [])
}

export function dismiss(profileId: string, companyId: string): Set<string> {
  if (!profileId || !companyId) return dismissedFor(profileId)
  const store = read()
  const next = new Set(store[profileId] ?? [])
  next.add(companyId)
  store[profileId] = [...next]
  write(store)
  return next
}

/**
 * Forget dismissals for companies that no longer qualify, so the key cannot
 * grow forever and, more importantly, so a company that LOSES its last contact
 * prompts again. Dismissing "nobody here yet" answers a question about a
 * specific emptiness; a later emptiness is a new question.
 */
export function pruneTo(profileId: string, stillEmpty: Iterable<string>): Set<string> {
  if (!profileId) return new Set()
  const keep = new Set(stillEmpty)
  const store = read()
  const next = (store[profileId] ?? []).filter((id) => keep.has(id))
  store[profileId] = next
  write(store)
  return new Set(next)
}

/** Sign-out sweep. Mirrors signOutCompletely's treatment of its own keys. */
export function clearAllDismissals(): void {
  if (typeof window === "undefined") return
  try { window.localStorage.removeItem(KEY) } catch {}
}
