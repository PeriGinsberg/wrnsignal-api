# Networking Unification — JobFit → Tracker Integration

Status: BRAINSTORM / architecture, not yet built. Captures the decisions made so far so they
don't scatter. This is a major cross-feature change — it merges the JobFit engine's networking
function into the Network Tracker and links networking to the job tracker.

## The strategic goal

The product should *perform the coaching methodology*: "apply, then network." Today that's two
disconnected motions in two parts of the app — a user runs JobFit, gets throwaway networking
advice, then separately has to build networking in a different tool, re-entering the company.
After this change, the application event feeds the tracker directly, and networking has one home.

## What moves, what dies, what's born

**JobFit's networking function today produces:**
- Targeting *guidance* ("look for hiring managers, VPs, alumni") — not named people
- A set of LinkedIn boolean search queries (click → opens LinkedIn pre-searched)

**Neither is duplicated by the Tracker.** So this is a RELOCATION, not a delete:
- The guidance and the LinkedIn search queries MOVE onto the company in the Tracker.
- JobFit gets simpler — it stops being a networking tool.
- The Tracker becomes the single home for all networking, fed by the application event.
- Nothing is lost; two capabilities gain persistence, contact-tracking, and application context.

The LinkedIn search relocation is also the seed of the future **contact-locator** — it now lives
in the right place to grow into one.

## The data model (decided)

**One networking company ↔ many job applications (including zero).**

- The **networking company is the stable anchor** (matched by name/domain, case-insensitive dedup —
  the tracker already does this).
- Each **job tracker application optionally points at a networking company** (the application
  carries the reference, not the other way around — decided).
- A wishlist company has zero linked applications. An applied-to company has one or more. Same
  company object; applications are extra context hanging off it. The board does NOT need "two kinds
  of company" — it's one kind with optional linked applications.
- Because the application points at the company by reference, **status stays live**: change
  Saved→Applied in the job tracker and networking reflects it, because networking reads the linked
  record, not a copy. Integration, not duplication.

Example on a company card: "2 applications — Senior PM (Applied), Data Lead (Saved)."

## The flow (decided)

1. User runs JobFit / Positioning / Cover Letter → job tracker entry auto-created, status **Saved**.
2. User is prompted: **"Add this company to your networking tracker?"**
3. Yes →
   - If the company already exists on the user's board → link to it.
   - If not → create the company entry.
   - Store the link from the application to that networking company.
4. Later, user flips the application Saved→Applied in the job tracker → networking shows Applied,
   live.

## What networking shows from the linked application (decided)

Per linked application, networking displays:
- Job title
- Status (live from the job tracker)
- URL to the application/job posting
- A one-click link to the full job tracker detail for that application

(Not needed on the networking side: the JobFit score, positioning, or cover letter — those stay
in JobFit; networking just needs to know an application exists and its state.)

## The company matching problem (flagged)

When JobFit pushes "Globex" and the board already has "Globex," they must link — but names are
fuzzy ("Globex" vs "Globex Inc" vs globex.com). This is the join that has to be right. Reuse the
tracker's existing case-insensitive company dedup (`uq_network_companies_name`, `lower(name)`),
and consider domain as a stronger match key when available. When ambiguous, the decision was:
**flag the user** ("Is this the same as your existing Globex?") rather than silently merge or
silently duplicate.

## Where the magic is: application-date-driven networking

This is the payoff no other tool has, and it's the literal embodiment of the coaching:
- The application date becomes a networking trigger. "You applied to the Senior PM role at Globex
  6 days ago and haven't networked anyone there yet."
- Surfaces on the dashboard's "needs attention" and/or as a nudge on the company.
- Ties the two systems together in a way that *drives behavior*, not just displays data.

## The generator's fate — RESOLVED (re-plumb, don't rewrite)

CC traced the current JobFit networking generator. Findings (corrected after a second, evidence-based trace):
- `POST /api/networking` is **already a standalone endpoint** taking `{ company, role, location }`
  and returning guidance + LinkedIn queries. It does NOT need the JobFit score, positioning, or
  cover letter. So it's a callable service today — no extraction surgery needed.
- `networking_runs` is **per-job persistent and retrievable**, NOT a transient cache. `GET
  /api/networking?jd_id=X` reloads it, and JobFit auto-loads saved guidance when a job is reopened.
  It's `unique (client_profile_id, jd_id)` — one row per job, and re-running the same job overwrites
  it (so no per-job *history*, but the latest guidance per job persists and users return to it).
  13 rows across 8 users on dev — real, retrievable data tied to real jobs.
- It fires **on-demand** (user clicks "Get networking guidance").

**Decision:**
- **Keep the generator** (`POST /api/networking`) — it already does the right job with the right
  inputs.
- **Change its destination:** instead of the JobFit-only view, store its output **on the networking
  company** and render on the company card — while keeping the per-job retrievability that exists
  today (a user returning to a job still sees its guidance).
- **`networking_runs` is the migration SOURCE, not a throwaway.** Guidance already exists for jobs
  users have run; the merge RELOCATES it onto companies rather than regenerating or discarding it.
  Guidance is keyed per-job today; because a job application points at a company in the new model,
  guidance-per-job maps cleanly onto guidance-on-company when that job is pushed to networking.
- **The JobFit networking section** becomes (or triggers) the "Add this company to your networking
  tracker?" prompt, carrying its already-generated guidance along.

This is re-plumbing (redirect where guidance lands, migrate existing rows onto companies), not a
rewrite. The generator and the guidance data both already exist and are well-formed.

## The guidance gets smarter, for free

The generator already accepts `role`. The tracker now knows the user's **target role and profile**.
So the guidance stored on the company can factor in who *this user* is trying to become — sharper
than JobFit's generic version — at no extra cost, because the input already exists. Fold the user's
target role/profile into the generator call at push-time.

## Remaining open questions

- **Guidance regeneration:** generated once at push-time and stored, or regenerable on the company
  if the user's profile changes? (Lean: generate at push, offer a "refresh guidance" action.)
- **The nudge mechanics:** how aggressive is the "you applied but haven't networked" prompt, and
  where does it live (dashboard needs-attention, company card, a notification)?
- **The prompt timing:** is "add to networking?" shown at JobFit completion, or also later from the
  job tracker (so a user who said no can change their mind)?
- **Existing `networking_runs` / `POST /api/networking`:** what happens to them — deprecated,
  repurposed to generate the guidance that now lives on the company, or kept as the guidance
  generator feeding the tracker?
- **Migration of existing data:** do users with existing JobFit networking runs get anything
  carried over, or does this only apply going forward?

## Scope note

This is a large, cross-feature change touching the JobFit engine, the job tracker, and the Network
Tracker. It should NOT be built until the current networking tracker is validated (the Erin/Maleri
usability test) and stable. This spec is the direction; sequencing comes later.

---

## Decision 2026-08-08: the old networking function is retired

Answering the open question above ("what happens to `networking_runs` / `POST /api/networking`"):
**deprecated, not repurposed.** The board on the dashboard is the only networking. The left-nav
Networking link in the Framer bundle now leaves the component for
`/dashboard/network/companies` (token handoff, same as `goToNetworkCompanies`) instead of opening
the in-component plan tab.

### KNOWN LIMITATION — the board cannot find people

Accepted deliberately, on dev, at the moment of retirement. Recorded here so it is not rediscovered
as a bug.

The two systems answered different questions, and only one of them survives:

| | old plan generator | new board |
|---|---|---|
| "Who should I be talking to?" | answered — role targeting + LinkedIn boolean searches | **no answer** |
| "What do I do with the people I have?" | no answer | answered — stages, reminders, templates, worklist |

So retiring the generator removes the only discovery affordance in the product. The new board
assumes the user already has names; nothing in it produces one. A user with an empty board and no
contacts has no in-product path forward — the "No one at {Company} yet" empty state on the
application detail asks them to add someone it cannot help them find.

**This is taken knowingly.** Discovery gets built after the push, and the relocation described
above — LinkedIn search queries moving onto the company in the tracker — is still the intended
shape for it. That relocation is the seed of the contact-locator; retiring the generator before
building it means the seed is currently unplanted, not lost.

Do not treat "the board can't find people" as a defect report until discovery ships.

### The retirement shape (approved 2026-08-08, NOT yet built)

Three steps, and the board is a destination rather than step 4.

JobFit → Positioning → Cover Letter is a complete arc: decide, position, write.
Networking was never really the fourth beat of it — it happens after you apply, it lives on a
different surface, and unlike the other three it persists. Modelling it as an in-component step is
part of why it produced a throwaway artifact.

**The board gets its own card on the home screen. It is not silently dropped.** Three cards would
undersell the product, and more importantly it would misdescribe it: the board is not a lesser
thing than the other three, it is the part still standing after the other three are finished.

So the card is deliberately NOT numbered and NOT styled as a step. It sits apart from the 1-2-3
rail, because a number would put it back in a sequence it has just been taken out of.

Draft copy, to be treated as the spec for the build:

    tag:  "Ongoing"
    head: "Your Networking Board"
    desc: "The companies you're chasing and the people you know inside them. Stages,
           reminders, and a worklist that says who to contact next. The other three
           finish when you apply. This one keeps going."

The last two sentences are the point of the card and should survive editing. The first sentence
says what it holds, the second says what it does, the third says why it is not a step. Copy that
describes it as "outreach" or "a plan" is describing the retired generator, not the board.

The card links out with the token handoff (`goToNetworkCompanies`), the same as the left nav.

**Known gap this card must not overclaim:** the board cannot find people (see the limitation
above). "Who to contact next" means next among the people you have already added. The copy must
not imply discovery until discovery ships.

### Build order when this is picked up

The three remaining entry points are three renderings of one four-step narrative, and each computes
state positionally, so they cannot be snipped independently.

1. Cover letter footer (`goTo("networking")`) → `goToNetworkCompanies`, relabelled to name the
   destination. This becomes the terminal CTA of the three-step arc.
2. Collapse the step rail, the step cards, and `STEP_META` to three entries. The `indexOf` maths
   then works unchanged on a three-element list.
3. Delete the four copy-pasted "Run Networking" CTA cards and fix the hardcoded `isActive` index
   in each surrounding block. These are the copy-paste hazard: four near-identical literals.
4. Remove `"networking"` from `TabKey` and `TAB_KEYS` LAST, so the compiler finds what steps 1-3
   missed instead of a human hunting for it.
5. Then the dead code: `runNetworking`, `renderNetworking`, its `return` in the tab switch, the
   `networkingResult` / `loadingNetworking` state, the reset, and `hasAnyResult`.
6. Easily missed: the rehydration line `if (data.networking) setNetworkingResult(data.networking)`,
   fed by `fetchRelated("networking_runs")` in `/api/runs/[id]`. Already returns null because that
   lookup is on the dead fingerprint_hash path, so removing it changes no behaviour — but left in
   place it reads as a live feature.
7. Drop `networking_runs` from the artifact-write monitor's `WATCHED_TABLES` when writes stop, or
   it alerts daily for seven days on an intended change.

`POST /api/networking` and the `networking_runs` table STAY. The mobile app calls the route
independently and installed builds keep calling it long after the web retirement; the table holds
coach-visible history and coach notes keyed to run ids.

Steps 1-4 are the user-visible change and touch the Framer bundle, which has no test gate. That
combination — no gate, plus four hand-copied index literals — is why this is scheduled as its own
session rather than tacked onto the usability fixes.
