# GET /api/applications carries the job postings it never shows

Measured 2026-08-05 on dev, against the busiest profile (35 applications).

```
total response          132,668 bytes
of which job_description 101,239 bytes   (76%)
```

Logged separately rather than folded into the company-link work, because the
fix is not a tweak: it needs a decision about who actually reads that field.

---

## What the field is for

`jobfit_runs.job_description` is the raw posting captured at scoring time. It is
embedded into every row of `GET /api/applications`:

```ts
.select("*, signal_interviews(id), client_personas(name),
         jobfit_runs!jobfit_run_id(job_description), ...")
```

The route's own comment explains why it exists:

> *"Read-only JD captured at scoring time, surfaced for interview prep after
> the posting comes down."*

That is a real need. Someone interviewing next week whose posting has been
taken down still has the text. The problem is not that we keep it, it is
**where it is delivered**.

## Who reads it

| Caller | Uses job_description |
|---|---|
| `app/dashboard/tracker/[applicationId]/page.tsx` | YES, one row, in a drawer |
| `app/dashboard/tracker/page.tsx` (the list) | no |
| `app/dashboard/page.tsx` (the home dashboard) | no |
| mobile tracker tab | no |

So the list screens pull roughly 100KB of posting text per load to render
titles and status pills. On production, with 993 applications across all
profiles and a heavier average posting, one user's list load is the same shape
at a larger scale.

## Why this was not fixed alongside the contact-count badge

The badge added a nested count embed to the same query: **875 bytes, under 1%**.
Adding that and then rewriting the endpoint's projection in the same commit
would have mixed a small addition with a change to who-gets-what, and made both
harder to reason about. The count is additive; this is a removal, and removals
need to know their readers.

## The options, none chosen

1. **Drop it from the list read, fetch it on the detail page.** The detail page
   already fetches the whole applications list to find its one row (there is no
   `GET /api/applications/[id]`), so this needs that endpoint to exist first, or
   a `?id=` projection. Cleanest end state, most work.
2. **A `?fields=` or `?slim=1` parameter**, the same shape as the `?company_id=`
   scoped read added for the networking surfaces. Smallest change, but it adds
   a second axis of projection to an endpoint that now has two.
3. **Leave it.** It is 100KB on a warm connection and nobody has complained.
   Worth saying out loud as a real option rather than pretending the fix is
   free.

## What would make the decision

Whether `GET /api/applications` should stay one endpoint serving both a list
and a detail page. The detail page reading the whole list to find one row is
the underlying oddity; the payload weight is a symptom of it.
