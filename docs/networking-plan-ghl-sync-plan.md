# Networking Plan → GoHighLevel sync

Status: **plan only, nothing built.** Written 2026-09-24.
Companion to `networking-plan-delivery-plan.md`, which covers HTML → PDF → Drive.

When the coach clicks **Share with client**, SIGNAL additionally calls GHL to:

1. set the contact custom field **Networking Plan URL** to the Drive link,
2. add the tag **`networking-plan-shared`** (a GHL workflow on that tag sends the client email),
3. add a note: *"Networking Plan shared from SIGNAL on [date]"*.

Facts about the repo and prod were checked on 2026-09-24. Facts about the GHL
API were read from the current developer docs and are cited. Where the two
disagree, this document says so rather than picking one.

---

## 1. The most important finding: we already do this

`app/api/seat-create/route.ts` contains a **working GHL v2 integration** that
already sets a contact custom field. It is the template for all of this:

```ts
const url = `https://services.leadconnectorhq.com/contacts/${encodeURIComponent(contactId)}`

const res = await fetch(url, {
  method: "PUT",
  headers: {
    Authorization: `Bearer ${token}`,
    Version: "2021-07-28",
    "Content-Type": "application/json",
    Accept: "application/json",
    LocationId: locationId,
  },
  body: JSON.stringify({
    customFields: [{ id: fieldId, value: magicLink }],
  }),
})
```

Environment variables that already exist and are already wired:

| Var | Used for |
|---|---|
| `GHL_API_KEY` | Bearer token |
| `GHL_LOCATION_ID` | `LocationId` header |
| `GHL_MAGIC_LINK_FIELD_ID` | the custom field id for the magic link |
| `GHL_WEBHOOK_SECRET` | inbound webhook auth (`seat-create`) |
| `GHL_HOMEWORK_WEBHOOK_URL` | outbound webhook (`homework-complete`) |

So **custom-field-set is solved**. Only tags and notes are new, plus contact
resolution.

**Only one new variable is needed: `GHL_NETWORKING_PLAN_FIELD_ID`.** Custom
fields are addressed by id, not by name, so "Networking Plan URL" must be
created in GHL first and its id pasted into env. A field addressed by the
label in the brief would silently write nothing.

---

## 2. Auth

Private Integration Token, sent as `Authorization: Bearer <token>` with the
`LocationId` header — exactly the shape `seat-create` already uses. A PIT is
scoped to a single sub-account, which is the right shape here: SIGNAL talks to
one location.

**Two things to confirm before building, neither of which I can settle from
here:**

**(a) The `Version` header disagrees with the current docs.** The working code
sends `Version: "2021-07-28"`. Every current docs page I read —
[add tags](https://marketplace.gohighlevel.com/docs/ghl/contacts/add-tags/),
[create note](https://marketplace.gohighlevel.com/docs/ghl/contacts/create-note/),
[upsert contact](https://marketplace.gohighlevel.com/docs/ghl/contacts/upsert-contact/)
— specifies `Version: v3`. Both may be accepted; the date form is the long-standing
v2 convention and the code demonstrably works in production. **Do not silently
switch the existing call to `v3`**, and do not assume the new calls need the same
value as the old one. Probe each endpoint once against the real location and
record what each accepts.

**(b) `GHL_API_KEY` is named like a legacy v1 API key but is used as a Bearer
token.** It may already hold a Private Integration Token. Confirm which it is —
legacy v1 keys are being retired and a rename to `GHL_PRIVATE_TOKEN` would stop
the next reader guessing.

**Rate limits:** 100 requests per 10 seconds burst and 200,000 per day, per app
per location, with `429` on breach and headers describing current position
([rate limits](https://marketplace.gohighlevel.com/docs/other/rate-limits/)).
Three calls per share is nowhere near either ceiling. This only matters if a
bulk re-share is ever built.

---

## 3. Matching a SIGNAL client to their GHL contact

This is the weakest link and deserves the most care.

### What exists

`signal_seats.ghl_contact_id` is populated on **24 of 24 rows**. But:

```
signal_seats rows                                   : 24
  with ghl_contact_id                               : 24
  claimed (used_at set)                             : 0
  seat emails matching a client_profiles.email      : 9 of 24

coach_clients   (74 rows)  has a GHL column?        : no
client_profiles (176 rows) has a GHL column?        : no
```

**`signal_seats` is not a usable mapping for coached clients.** It covers seat
purchasers — a different and much smaller cohort than the 74 `coach_clients`,
and only 9 of its 24 emails resolve to a client profile at all. Treating it as
the lookup table would silently fail for most clients.

### Recommended approach

**Resolve once, store on `coach_clients`, never re-resolve silently.**

```sql
ALTER TABLE public.coach_clients
  ADD COLUMN IF NOT EXISTS ghl_contact_id text,
  ADD COLUMN IF NOT EXISTS ghl_contact_resolved_at timestamptz;
```

Resolution uses `POST /contacts/upsert` with `locationId` and the client's email
([docs](https://marketplace.gohighlevel.com/docs/ghl/contacts/upsert-contact/)).
The response returns `{ new: boolean, contact: {...}, traceId }`, so it says
explicitly whether it matched or created.

**Three cautions on that endpoint:**

1. **It can create.** `upsert` will make a new contact if none matches. For a
   coached client who genuinely is not in GHL that may be correct, but it should
   be a deliberate choice surfaced to the coach, not a side effect of clicking
   Share. If creation is unwanted, resolve with a search and fail closed instead.
2. **The matching rule is a GHL setting, not ours.** The docs state upsert
   "respects the location-level *Allow Duplicate Contact* setting" and matches on
   email and/or phone "based on the priority sequence specified in the setting".
   So whether two SIGNAL clients sharing a phone collapse into one GHL contact is
   decided in the GHL UI, out of our control. **Read that setting before building**
   and write down what it is.
3. **Which email?** `coach_clients.invited_email` and `client_profiles.email`
   both exist and can differ — the same unresolved question as the Drive plan.
   Picking wrong here does not just misfile a document; it emails the plan link
   to the wrong person.

**Resolution should happen at folder-setup time, not at share time.** The coach
already pastes a Drive folder URL per client; resolving and displaying the
matched GHL contact name in the same step lets a human catch a bad match before
anything is sent. Resolving lazily inside the Share click means the first time
anyone discovers the wrong contact is after the email has gone.

---

## 4. Call order, and why it is not arbitrary

The three GHL calls are **not atomic** and one of them has a side effect that
reaches the client.

> **Custom field first. Note second. Tag last.**

The tag fires the workflow that sends the email, and that email presumably
renders the Networking Plan URL field. If the tag is added before the field is
set, the workflow can fire against a contact whose URL field is still empty or
holds the *previous* plan's link. The client then receives an email with a blank
or wrong link, and no retry can un-send it.

The note is ordered before the tag only because it is cheap and harmless; if it
fails, the share should still proceed.

Full ordering across both systems:

| # | Step | System | If it fails |
|---|---|---|---|
| 1 | Grant client viewer on the Drive file | Drive | abort, nothing visible |
| 2 | Flip `visible_to_client = true` | SIGNAL | retry; client has access but no app entry |
| 3 | Set **Networking Plan URL** custom field | GHL | **stop — do not tag** |
| 4 | Add note | GHL | log, continue |
| 5 | Add tag `networking-plan-shared` | GHL | retry; nothing has been sent yet |

Steps 1-2 are unchanged from `networking-plan-delivery-plan.md` §5.4, where the
reasoning for sharing before flipping is set out.

---

## 5. What happens if GHL fails after Drive sharing succeeded

This is the question the brief asks, and the answer is: **it is safe, because
the client has not been told anything yet.**

The Drive share grants access. It sends nothing — `sendNotificationEmail: false`
is already required by the delivery plan. So a client with Drive access and no
GHL tag is in a quiet, correct, resumable state: they *could* open the link if
they had it, but nobody has given it to them.

That makes the failure mode benign and the retry obvious:

- **Field set failed (step 3).** Nothing sent. Retry. Never proceed to the tag —
  tagging now emails a blank link.
- **Note failed (step 4).** Cosmetic. Log it, continue to the tag. A missing note
  is a lost audit line, not a broken delivery.
- **Tag failed (step 5).** Nothing sent. Retry. This is the only step whose
  success means "the client has been emailed", so it is the only one where
  "did it work?" genuinely matters.

**The dangerous direction is the reverse** — GHL succeeding and Drive failing.
That emails the client a link they cannot open. Keeping Drive first makes that
ordering impossible.

### Recording it

Extend `networking_plan_jobs` (proposed in the delivery plan):

```sql
ALTER TABLE public.networking_plan_jobs
  ADD COLUMN IF NOT EXISTS ghl_contact_id      text,
  ADD COLUMN IF NOT EXISTS ghl_field_set_at    timestamptz,
  ADD COLUMN IF NOT EXISTS ghl_note_added_at   timestamptz,
  ADD COLUMN IF NOT EXISTS ghl_tag_added_at    timestamptz,
  ADD COLUMN IF NOT EXISTS ghl_last_error      text;
```

Four separate timestamps, not one `ghl_synced` boolean. The retry list is then a
query rather than a guess:

```sql
-- shared with the client but never emailed
SELECT * FROM networking_plan_jobs
WHERE shared_at IS NOT NULL AND ghl_tag_added_at IS NULL;
```

`ghl_tag_added_at` is the one that means "the client has been emailed". It is the
column to check before ever tagging again.

---

## 6. Should re-sharing re-trigger the email?

**Recommendation: no by default, yes only on an explicit "re-send" action.**

### The mechanics

A GHL *Contact Tag* workflow trigger fires when a tag is **added**. Adding a tag
that is already present is a no-op for tag state — the add-tags endpoint returns
"the current tags on the contact after the operation"
([docs](https://marketplace.gohighlevel.com/docs/ghl/contacts/add-tags/)) — but
whether a no-op add still fires the trigger, and whether the workflow permits
re-entry at all, are **GHL workflow settings we do not control from the API**.

So "does re-sharing re-send?" cannot be answered from SIGNAL's side alone. That
is precisely why it should not be left to chance.

### The rule

Make it explicit in SIGNAL rather than relying on GHL's re-entry behaviour:

- **Default re-share** (coach re-shares an updated plan): update the custom field
  to the new URL, add a note, and **do not touch the tag** if `ghl_tag_added_at`
  is already set. The client keeps their link, the URL field now points at the
  new PDF, and no second email goes out.
- **Explicit re-send** (a distinct button, or a checkbox on the share dialog):
  remove the tag, then add it again, so the trigger definitely fires. Record a
  new `ghl_tag_added_at`.

Removing-then-adding is the only reliable way to guarantee a re-fire, and
guaranteeing it is exactly what an explicit re-send button is promising.

**The failure to avoid:** a coach fixes a typo, re-shares, and the client gets a
second identical email. That erodes trust in the tool faster than a missing
feature does.

---

## 7. Open questions

1. **Which email identifies the client** — `invited_email` or
   `client_profiles.email`? Unresolved in both plans, and here it decides who
   receives the email.
2. **Is the location's *Allow Duplicate Contact* setting email-only, phone-only,
   or both?** It silently governs who we match.
3. **Should Share create a GHL contact** if none exists, or fail closed?
4. **`Version` header:** `2021-07-28` (working, in repo) or `v3` (current docs)?
5. **Is `GHL_API_KEY` a Private Integration Token or a legacy v1 key?**
6. **Does the GHL workflow's email template read the Networking Plan URL custom
   field?** If it does not, step 3's ordering argument still holds but the field
   is only useful to humans browsing the contact.
7. **Note author.** `create-note` accepts a `userId` for the note author; with a
   PIT there may be no natural user to attribute it to. Confirm whether the note
   appears sensibly without one.

---

## 8. Verified vs not

**Verified against the repo and prod, 2026-09-24:** the existing GHL integration
in `seat-create` and its exact header and body shape; the five existing `GHL_*`
env vars; `signal_seats` row counts and `ghl_contact_id` coverage; that
`coach_clients` and `client_profiles` have no GHL column; the 9-of-24 email
overlap.

**Read from the current GHL developer docs and cited inline:** add-tags, create-note
and upsert-contact method/path/body shapes; the `Version: v3` header value; the
upsert duplicate-detection behaviour and `new` flag; rate limits.

**Not verified — needs a probe against the real location:** which `Version` value
each endpoint actually accepts; whether a no-op tag add re-fires a workflow;
whether the workflow allows re-entry; the location's duplicate-contact setting;
note behaviour without a `userId`.
