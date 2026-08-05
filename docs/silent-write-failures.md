# Silent write failures — inventory

Taken 2026-08-05, after `positioning_runs` stopped persisting on production for
roughly two weeks with **zero signal**.

Written down so this is not rediscovered a third time. The profile-save outage
(2026-06-07 → 2026-08-04, eight weeks) was the same shape.

---

## The shape

A write fails, the failure is logged and dropped, and the request returns
success. Three ingredients, all present in the positioning bug:

1. **The write is secondary to the response.** The generated content is the
   "real" output; persistence feels like bookkeeping.
2. **`console.warn`, not `console.error`.** Warn is filtered out of most log
   views by default, so the message existed and nobody ever saw it.
3. **Nothing reconciles.** No job asks "does every run have a row?", so absence
   is invisible. A table that stops receiving writes looks exactly like a quiet
   week.

The profile-save bug had 1 and 3. It surfaced only because the *whole* write
failed loudly enough to reach a user — and even then it took eight weeks.

**Two things would have caught positioning without touching any call site:**
`console.error` on artifact writes, and one query counting rows per day per
table. The second would have fired on 2026-07-24.

---

## Counts at time of writing

| | |
|---|---|
| write failures logged and swallowed | 65 |
| empty `catch {}` | 19 |
| fire-and-forget `.catch(() => {})` | 6 |

Most are fine. The shape only matters when **a user is told success while data
is lost**. Ranked by that below.

---

## Tier 1 — core artifact lost, success returned

The four run tables share one code pattern. `positioning_runs` is the one that
fired; the other three are the same code, one missing column away from the same
outage.

| File | Table |
|---|---|
| `app/api/positioning/route.ts` | `positioning_runs` ← the one that fired |
| `app/api/coverletter/route.ts` | `coverletter_runs` |
| `app/api/networking/route.ts` | `networking_runs` |
| `app/api/jobfit/route.ts` | `jobfit_runs` |

All four return `200` with the generated content. The user reads their result,
closes the tab, and it was never saved.

**`jobfit_runs` is the worst of the four** — it is the anchor every other
artifact links to by `jobfit_run_id`, so a failure there silently orphans
everything downstream for that job, not just its own row.

**STATUS: addressed 2026-08-05 (Commit A).** All four now log
`console.error` with a greppable marker:

```
ARTIFACT_WRITE_FAILED table=<name> profileId=<id> reason=<msg>
```

Response behaviour is deliberately UNCHANGED — still `200` with content. A
reader with an unsaved result is better off than one with an error. This was
about signal, not behaviour.

---

## Tier 2 — money and access

Lower probability, higher consequence. **Not yet addressed.**

### `app/api/stripe/refund/route.ts` — the one to look at first

Not the same mistake. It is a deliberate, documented trade with a real hole:

```ts
if (updateErr) {
  console.error("[refund] Access revoke failed:", updateErr.message)
  return { ok: true, warning: "Refund issued but access could not be updated. Contact support." }
}
```

The refund **has already gone through at Stripe**. If the `active: false` write
fails, the user keeps full access *and* has their money back. The comment says
"surface the error so support can finish the cleanup" — but the only surfacing
is a `console.error` and a `warning` string the UI never renders. Nothing pages
anyone. Correctly not failing the request; the gap is that "support" is never
actually told.

### Others in this tier

| File | Swallowed |
|---|---|
| `app/api/webhooks/stripe/route.ts` | purchases insert, insert, refund update |
| `app/api/iap/revenuecat-webhook/route.ts` | purchase insert, refund update, link-existing update, admin.createUser |
| `app/api/checkout/create-session/route.ts` | `unlock_capture` insert and update |

---

## Tier 3 — audit trails that vanish with no symptom

**No changes planned.** Recorded so the trade is explicit rather than forgotten.

| File | Swallowed |
|---|---|
| `app/api/_lib/applicationStatusHistory.ts` | `[status_history] log failed` |
| `app/api/_lib/coachClientEvents.ts` | insert failed, and insert threw |
| `app/api/_lib/conversions/index.ts` | funnel insert failed, insert failed |

`applicationStatusHistory` deserves a note. Its own comment says *"Non-fatal:
status is already in client_profiles, history is for analytics + heuristics"* —
a sound call when written. But since 2026-08-04 it also feeds the **user-facing
job History log** on the application detail page. A swallowed failure now shows
up as a gap in someone's timeline that looks like the event simply never
happened, and nobody would know to look.

---

## Tier 4 — partial account provisioning

**No changes planned.**

`app/api/coach/create-client/route.ts`,
`app/api/coach/coach-clients/[id]/send-invite/route.ts`, and
`app/api/coach/coach-clients/[id]/setup-account/route.ts` each swallow: the
initial persona insert, the system note insert, and the `history_boundary`
stamp. The account exists but is missing pieces, and the coach is told it
worked.

Three near-identical copies — the same account-creation triplication that
produced the `invited_at` bug.

---

## Tier 5 — correctly swallowed, not bugs

Listed so the inventory stays credible and nobody "fixes" these.

- **Rollback cleanup** — `try { delete profile } catch {}` after a failed
  create. Best-effort by design; the original error is already being returned.
- **UI refresh** — `try { await onChange() } catch {}`.
- **`window.close()`**, clipboard and storage access.
- **`app/dashboard/tracker/page.tsx`** mark-all-seen — deliberately optimistic;
  re-showing a banner on a failed write is worse than the write not sticking.
- **`app/dashboard/tracker/interviews/[interviewId]/page.tsx`** — chain
  continuation guard; the real failure is handled by the `!res.ok` branch
  immediately after.

---

## Open work

| | Status |
|---|---|
| Commit A — Tier 1 signal | done 2026-08-05 |
| Commit B — reconciliation query | proposed, not built |
| Commit C — stripe refund alerting | proposed, not built |
| Tiers 3, 4, 5 | no changes, by decision |
