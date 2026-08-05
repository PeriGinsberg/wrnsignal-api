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

## The monitor (Commit B)

`GET /api/internal/monitor/artifact-writes`, daily at 13:00 UTC via Vercel Cron.

**Watched tables** are one declared constant, `WATCHED_TABLES`, so adding one
later is a one-line change rather than a hunt through a query:
`jobfit_runs`, `positioning_runs`, `coverletter_runs`, `networking_runs`,
`interview_prep_runs`.

**The signal is zero-in-24h and nothing else.** Unambiguous, and it catches the
failure that actually happened — it would have fired on 2026-07-24, one day
after the last positioning write. Week-over-week drop detection was considered
and deferred: it is where false positives begin, and a monitor that cries wolf
gets muted, which is the same failure mode as no monitor, arrived at slowly.

A table with **no rows in the whole 7-day window** is treated as NEW, not
silent. `interview_prep_runs` is exactly that today. Only a table with history
behind it can go quiet.

A table that cannot be **read** is reported separately from one that is quiet.
Reporting an unreadable table as "0 rows" would be the monitor inventing a
clean answer out of a broken one.

**Liveness has three layers**, because a monitor you cannot distinguish from a
dead one gives false comfort:

1. `monitor_runs` gets a row on EVERY run, healthy or not, written BEFORE the
   email so a Postmark outage cannot make a run that happened look like one
   that never did. `SELECT max(ran_at) FROM monitor_runs` — older than ~25h and
   it is dead.
2. An external dead-man's switch (Healthchecks.io) is pinged on success, and
   the result is reported in the response as `pinged: true | false |
   "not_configured"` — the monitor STATES whether its own switch is armed
   rather than leaving it to be inferred. It
   alarms when the pings STOP, which is the only arrangement where the monitor
   failing is itself alerted on, because the alarm lives outside the system it
   watches.
3. A thrown monitor logs `MONITOR_FAILED` and deliberately does NOT ping the
   switch — letting the silence be noticed is the point.

**The alert lands in email**, to `support@stopapplyingblind.com` via the
existing Postmark sender path. It names the silent table in the subject and
includes 7 days of counts for **every** watched table, so a cliff can be told
from a slope at a glance. It sends only when something is wrong: a daily
all-clear becomes noise inside a week, then gets filtered, and then it is a
dead monitor nobody notices is dead.

**Known gap, stated rather than implied away:** this does not catch per-user
partial failure. One profile's writes failing while others succeed produces a
lower count, not a zero. `ARTIFACT_WRITE_FAILED` in the logs is the only signal
for that, and it is grep-on-demand, not push.

**ALERTS ARE OPT-IN PER ENVIRONMENT and default to OFF.** Found by dry-running
the count logic against dev before shipping: this signal is calibrated for
PRODUCTION volume. Prod does ~40 `positioning_runs` a day, so zero is
unambiguous. Dev does 2 `jobfit_runs` a *week*, so "0 in 24h" is a normal
Tuesday. Vercel crons run on every project deploying this `vercel.json`, and
the staging project deploys as "production" — so without the guard, staging
would send daily false alarms, they would get filtered, and the real alert
would be filtered with them. That is precisely the failure mode this commit
exists to prevent.

The monitor still runs and still writes its heartbeat in every environment,
which is what makes it verifiable on dev. It only declines to email.

**Required environment variables:**

| Variable | Where | Effect |
|---|---|---|
| `CRON_SECRET` | every env running the cron | bearer token Vercel Cron sends; without it the route 401s (fail closed) |
| `MONITOR_ALERTS_ENABLED` | **prod only**, set to `true` | enables the email. Absent or anything else = never emails |
| `HEALTHCHECKS_PING_URL` | **prod only** | Healthchecks.io dead-man's switch. Response reports `pinged`; `"not_configured"` when unset |

**Do NOT set `HEALTHCHECKS_PING_URL` on staging.** Staging pinging the
production check would keep it green while production was dead — an alarm that
actively lies, which is worse than no alarm.

**A bug worth remembering, because it happened inside the tool built to prevent
it.** The first version read `HEALTHCHECK_PING_URL` while the variable was
named `HEALTHCHECKS_PING_URL`. It returned early on every run and the
swallowing catch logged nothing, so the monitor answered `ok: true` while its
own liveness switch had never been armed. Caught during dev verification by
checking the variable name against the code rather than trusting the 200. The
fix was not only the rename: the ping result is now surfaced in the response,
so this class of failure is visible rather than silent.

---

## Open work

| | Status |
|---|---|
| Commit A — Tier 1 signal | done 2026-08-05 |
| Commit B — reconciliation monitor | built 2026-08-05, dev only — NOT yet on prod |
| Commit C — stripe refund alerting | proposed, not built |
| Tiers 3, 4, 5 | no changes, by decision |
