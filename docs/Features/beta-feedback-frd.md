# FRD: In-System Beta Feedback — v0.1

**Feature ID:** [Assigned by PM]
**Category:** Coaches Center / Beta Infrastructure
**Release:** Beta Feedback v0.1
**Status:** Draft — awaiting Peri approval
**Author:** Peri Ginsberg + Claude (design conversation 2026-05-27)
**Date:** 2026-05-27

---

## 1. Context and motivation

The Coaches Center beta launches imminently with 4-5 founding coaches as the initial cohort. Erin's outreach plan calls for a structured feedback loop, but the proposed infrastructure (shared email inbox + Google Form + Airtable log) has real friction:

- Feedback lives outside the product — context is lost ("which screen were you on?")
- Coaches have to remember where to submit
- Coaches have to context-switch out of their workflow
- We lose the implicit signal of *when* in the workflow the friction hit

An in-product feedback channel addresses all four. It's also a wedge for future user-initiated email features (client-to-coach messaging, automated session recaps, weekly digests, status-change notifications) — once Postmark is wired to authenticated app actions writing to a row that triggers a templated email, the pattern is reusable.

**Core principle: lowest friction submission, highest signal capture.**

A coach experiences friction → clicks a button visible from any page → fills a small form → submits. The coach goes back to work. The system captures everything else: who they are, where they were, what device, when. You and Erin learn about it within minutes via email at the new `support@stopapplyingblind.com` shared inbox.

**Coach-only in v0.1.**

Client feedback is valuable but secondary; coaches are the buyers and their feedback drives roadmap. A client who hits a bug tells their coach; the coach files via this channel with their professional context. Adding client access multiplies feedback volume 5-10x with lower-quality signal in the early window. v0.2 territory.

---

## 2. Goals and non-goals

### Goals

1. Coaches can submit feedback from any page in the Coaches Center
2. Five note types capture the kinds of input we expect (Issue/Bug, Enhancement, Technical Question, General Feedback, Other)
3. Severity sub-field on bugs (Blocker/High/Medium/Low) helps triage
4. Auto-captured context (user, URL, timestamp, user agent) eliminates the "where were you?" round-trip
5. Submission persists in a `beta_feedback` table for durable record-keeping and future admin work
6. Email-on-insert to `support@stopapplyingblind.com` notifies you and Erin within seconds
7. Reply-To header set to the coach's email so replies thread directly to them
8. Coach sees inline confirmation after submit ("Thanks — we got it")

### Non-goals (v0.1)

- **Client access** — coach-only via `is_coach = true` gate (v0.2)
- **In-product admin UI** for triaging feedback — handled via email + Supabase Studio (v0.2)
- **Status updates visible to coach** ("acknowledged", "in progress", "shipped") — v0.2 if/when admin UI ships
- **Screenshot attachments** — text-only in v0.1
- **Voting on enhancement ideas across coaches** — v0.3+ if/when volume justifies
- **Auto-categorization or AI triage** — out of scope
- **Mobile** — coach UI is web-only per existing scope
- **Slack/Discord webhook notification** — email-only in v0.1
- **Multi-language support** — English-only

---

## 3. Scope

This FRD covers:

1. **`beta_feedback` table** (new schema, single table)
2. **One API endpoint** — POST `/api/feedback`
3. **Postmark email-on-insert** — fires within the POST handler after row commits
4. **Frontend slide-in component** — triggered from a Feedback item in the COACHES CENTER sidebar nav
5. **Coach-only access gate** (`is_coach = true` on both button visibility and endpoint auth)
6. **Inline confirmation UX** after successful submit
7. **Dev-first ship**, production promotion as a separate explicit step

---

## 4. Design principles

### 4.1 Low friction submission

Fewer than 30 seconds from "I want to file feedback" to "submitted." The form is small. Required fields are minimal (type + body). Severity only appears when type = Issue/Bug. No screenshots, no attachments, no multi-step wizards.

### 4.2 Auto-capture beats manual fields

Every piece of context that can be derived from the session is auto-captured rather than asked of the coach. Coach's identity, current URL, browser, timestamp — all invisible to the form. Active client count for that coach is included in the email notification to help weight feedback at a glance.

### 4.3 Email-first notification

You and Erin don't have to remember to check a new dashboard. Email arrives in `support@stopapplyingblind.com` (forwarded to your personal inboxes) within seconds of submission. Reply-To is the coach's email so threading is one click.

### 4.4 Coach-only scope is deliberate

Restricting to coaches in v0.1 is not a technical limitation — it's a deliberate product decision to keep beta feedback signal-rich. The schema and endpoint will work identically for client access when v0.2 enables it. Gate is one line of code.

### 4.5 No filler features

v0.1 ships only what's needed for coaches to submit feedback and for you/Erin to receive it. Admin UI, status updates, voting, attachments — all deferred until real beta usage reveals what's actually needed.

---

## 5. User flow

### 5.1 Entry

Coach clicks **Feedback** in the COACHES CENTER sidebar nav (alongside Dashboard, Required Actions, My Clients, Prospects). The button is always visible to authenticated coaches. Clicking it opens a slide-in panel from the right side of the viewport.

### 5.2 Form

The slide-in panel renders a small form with these fields:

**Type** (single-select, required):
- Issue / Bug
- Enhancement
- Technical Question
- General Feedback
- Other

**Severity** (single-select, required ONLY when Type = Issue / Bug):
- Blocker
- High
- Medium
- Low

(Hidden / not rendered for any other Type value.)

**What happened / what would you like?** (textarea, required):
- Placeholder text adapts to Type:
  - Bug: "What were you trying to do? What happened instead?"
  - Enhancement: "What would you like to see? What problem would it solve?"
  - Technical Question: "What are you trying to figure out?"
  - General Feedback: "Share whatever's on your mind."
  - Other: "Tell us what's up."
- Minimum 10 characters. Maximum 5000 characters.

**Reply OK?** (checkbox, default checked):
- Label: "OK to reply via email"
- When unchecked, the email notification still fires (you/Erin still see it), but the Reply-To is set to a no-reply address so you know not to respond directly.

**Submit** button (primary CTA, bottom right of panel):
- Disabled until Type and body (min 10 chars) are filled
- Disabled when Type = Bug and Severity is unselected
- On click: sends POST request, disables button, shows inline loading state

### 5.3 Submit confirmation

On successful submit (200 response):
- Form replaces with inline confirmation in the same slide-in panel
- Heading: "Thanks — we got it."
- Body: "We'll reply within 1-2 business days if you asked us to. You can keep working — we'll find you."
- A single button: "Close" — closes the slide-in
- Slide-in does NOT auto-close. Coach explicitly dismisses.

### 5.4 Submit error

On error (any non-200 response):
- Form remains visible with all input preserved
- Error banner above Submit button: "Something went wrong on our end. Please try again or email us directly at support@stopapplyingblind.com."
- Submit button re-enables

### 5.5 What you and Erin see

Email arrives at `support@stopapplyingblind.com` within seconds of submission. Forwarded to your personal email and Erin's per the GoDaddy forwarding rules.

**Email subject:**
```
[SIGNAL Feedback] [Type] from [Coach Name]
```

Example: `[SIGNAL Feedback] [Issue/Bug] from Beth Hendler Grunt`

**Email body** (plain text or simple HTML):

```
[Coach Name] submitted feedback:

TYPE: [Type]
SEVERITY: [Severity if Bug, else "—"]
REPLY OK: [Yes / No]

MESSAGE:
[The submitted body, verbatim]

CONTEXT:
- Page: [URL the coach was on]
- Timestamp: [ISO8601]
- Browser: [User agent, parsed to friendly name]
- Coach's active clients: [Count]
- Coach's email: [Email]

ROW: [Link to Supabase Studio row]
```

**Reply-To header:**
- If `reply_ok = true`: coach's email address
- If `reply_ok = false`: `noreply@stopapplyingblind.com` (or omit Reply-To entirely)

---

## 6. Technical design

### 6.1 Data model — `beta_feedback` table

```sql
CREATE TABLE beta_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who submitted
  coach_profile_id UUID NOT NULL REFERENCES client_profiles(id),

  -- What they said
  type TEXT NOT NULL CHECK (type IN (
    'issue_bug', 'enhancement', 'technical_question',
    'general_feedback', 'other'
  )),
  severity TEXT CHECK (
    severity IS NULL OR severity IN ('blocker', 'high', 'medium', 'low')
  ),
  body TEXT NOT NULL CHECK (LENGTH(TRIM(body)) >= 10),
  reply_ok BOOLEAN NOT NULL DEFAULT true,

  -- Auto-captured context
  page_url TEXT,
  user_agent TEXT,

  -- Status (reserved for v0.2 admin UI; v0.1 always 'new')
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
    'new', 'acknowledged', 'in_progress', 'shipped', 'wontfix'
  )),
  status_updated_at TIMESTAMPTZ,
  status_updated_by UUID REFERENCES client_profiles(id),

  -- Notification tracking
  email_sent_at TIMESTAMPTZ,
  email_send_error TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_beta_feedback_coach_profile_id ON beta_feedback(coach_profile_id);
CREATE INDEX idx_beta_feedback_status ON beta_feedback(status);
CREATE INDEX idx_beta_feedback_created_at ON beta_feedback(created_at DESC);

CREATE TRIGGER update_beta_feedback_updated_at
  BEFORE UPDATE ON beta_feedback
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

**Schema notes:**

- `severity` is nullable because non-bug types skip severity entirely. CHECK constraint allows NULL OR one of the four values.
- `body` minimum length enforced at DB level (defense-in-depth alongside frontend min-length).
- `status` column populated even though v0.1 doesn't expose admin UI — reserved so v0.2 doesn't require a schema migration.
- `email_sent_at` and `email_send_error` track whether the Postmark send succeeded. Useful for debugging if a coach asks "did you get my feedback?" and we need to verify the email actually went out.
- No `client_profile_id` field — feedback is coach-scoped, not client-scoped (even if the coach was in a client's view when they hit Feedback). The URL is captured in `page_url` for that context.

Migration applies to dev first via the standard Supabase SQL Editor workaround per Foundation Risk 6.

### 6.2 API endpoint — POST `/api/feedback`

**Path:** `app/api/feedback/route.ts`

**Authentication:** Bearer token + inline `getAuthedUser` + profile
lookup selecting `is_coach`. Model after `app/api/coach/home/route.ts`.

Note: `getAuthedProfileText()` is NOT the canonical pattern for coach
routes — it throws on failure (rather than returning null), doesn't
return `is_coach`, and has a row-creation side effect. Coach routes
inline their own auth pattern. The new POST /api/feedback handler
follows this established pattern.

**Authorization:** Caller must have `is_coach = true` on their `client_profiles` row. Otherwise 403.

**Request body:**

```typescript
{
  type: 'issue_bug' | 'enhancement' | 'technical_question' | 'general_feedback' | 'other';
  severity?: 'blocker' | 'high' | 'medium' | 'low';  // required only when type='issue_bug'
  body: string;          // min 10 chars, max 5000 chars
  reply_ok: boolean;
  page_url: string;      // captured client-side from window.location.href
  user_agent: string;    // captured client-side from navigator.userAgent
}
```

**Response (201):**

```typescript
{
  feedback_id: string;
  created_at: string;    // ISO8601
  email_sent: boolean;   // true if Postmark accepted; false if send errored (row still committed)
}
```

**Error responses:**
- `400` — invalid body (type not in enum, severity present for non-bug type, body too short/long, missing required field)
- `401` — unauthenticated
- `403` — authenticated but not a coach (`is_coach = false`)
- `500` — DB write failed (Postmark failure does NOT 500; logged + returned as `email_sent: false`)

**Handler logic:**

Note: pseudocode uses `withCorsJson(req, data, status)` — the
existing codebase utility for coach route responses. Standard
response shape is `{ ok: boolean, ... }` with `error` and `message`
on failure or feature-specific fields on success.

```typescript
async function handlePOST(req: Request) {
  // 1. Auth (inline getAuthedUser + profile lookup; see §6.2 above)
  const profileId = await authenticateProfile(req);
  if (!profileId) {
    return withCorsJson(req, { ok: false, error: 'unauthenticated' }, 401);
  }

  // 2. Verify is_coach
  const profile = await getClientProfile(profileId);
  if (!profile?.is_coach) {
    return withCorsJson(req, {
      ok: false,
      error: 'coaches_only',
      message: 'Feedback is currently available to coaches only.',
    }, 403);
  }

  // 3. Parse and validate body
  const parsed = parseAndValidate(req);  // returns 400 on invalid input
  if (!parsed.ok) return parsed.response;  // a withCorsJson 400
  const { type, severity, body, reply_ok, page_url, user_agent } = parsed.data;

  // Cross-field validation: severity required for bugs only
  if (type === 'issue_bug' && !severity) {
    return withCorsJson(req, {
      ok: false,
      error: 'severity_required',
      message: 'Severity is required for Issue/Bug submissions.',
    }, 400);
  }
  if (type !== 'issue_bug' && severity) {
    return withCorsJson(req, {
      ok: false,
      error: 'severity_not_allowed',
      message: 'Severity should only be set for Issue/Bug submissions.',
    }, 400);
  }

  // 4. Insert row
  const { data: feedback, error: insertError } = await supabase
    .from('beta_feedback')
    .insert({
      coach_profile_id: profileId,
      type,
      severity: severity ?? null,
      body,
      reply_ok,
      page_url,
      user_agent,
    })
    .select('id, created_at')
    .single();

  if (insertError) {
    return withCorsJson(req, {
      ok: false,
      error: 'insert_failed',
      message: 'Failed to save feedback.',
    }, 500);
  }

  // 5. Fetch additional context for email
  const activeClientCount = await getActiveClientCount(profileId);

  // 6. Send notification email (non-fatal — row already committed)
  let emailSent = false;
  let emailError: string | null = null;

  try {
    await sendFeedbackNotification({
      feedbackId: feedback.id,
      coach: profile,
      type,
      severity,
      body,
      replyOk: reply_ok,
      pageUrl: page_url,
      userAgent: user_agent,
      activeClientCount,
    });
    emailSent = true;
  } catch (err) {
    emailError = err instanceof Error ? err.message : String(err);
    console.error('[feedback] email send failed', emailError);
  }

  // Update row with email status (best-effort, don't fail the response on this)
  await supabase
    .from('beta_feedback')
    .update({
      email_sent_at: emailSent ? new Date().toISOString() : null,
      email_send_error: emailError,
    })
    .eq('id', feedback.id);

  // 7. Return success
  return withCorsJson(req, {
    ok: true,
    feedback_id: feedback.id,
    created_at: feedback.created_at,
    email_sent: emailSent,
  }, 201);
}
```

**Key decisions captured here:**

- Email failure does NOT fail the request. Row committed > email sent. Coach gets confirmation even if Postmark hiccups; we can debug from logs + `email_send_error` column.
- `active_client_count` query is a small extra SELECT but worth it for the "weight of feedback" signal in the email.
- Active client count: `coach_clients` rows where
  `coach_profile_id = profileId AND status = 'active' AND
  lifecycle_status = 'Active'`. Excludes Prospects, Inactive, and
  Archived.

  This matches the "Active Clients" tile count on Coach Home, so the
  email number aligns with what the coach sees on their own dashboard.

### 6.3 Postmark integration

Implementation lives in `lib/email/sendFeedbackNotification.ts` (new file), modeled after `lib/email/sendClientInvite.ts`.

**Template approach:**

v0.1 uses inline template rendering (no Postmark template ID required) — simpler to iterate during the early beta period. Switch to a Postmark template when copy stabilizes (v0.2 territory).

**Template (plain text, with simple HTML version):**

```
[Coach Name] submitted feedback:

TYPE: [Type, friendly label]
SEVERITY: [Severity label, or "—"]
REPLY OK: [Yes / No]

MESSAGE:
[body, verbatim]

CONTEXT:
- Page: [page_url]
- Timestamp: [created_at, formatted]
- Browser: [user_agent, parsed via ua-parser-js or similar]
- Coach's active clients: [count]
- Coach's email: [email]

View row: [Supabase Studio deep link]
Reply to coach: [mailto: coach's email]
```

**Environment variable:** Add
`POSTMARK_FEEDBACK_FROM_EMAIL=support@stopapplyingblind.com` to env
config (both dev and prod). Distinct from the existing
`POSTMARK_FROM_EMAIL` (which sends from `@workforcereadynow.com` for
`sendClientInvite` and other WRN-branded transactional email).

Both `workforcereadynow.com` and `stopapplyingblind.com` are
domain-verified in Postmark, so any address on either domain can
send without per-address Sender Signature configuration.

**Postmark API call:**

```typescript
await postmarkClient.sendEmail({
  From: process.env.POSTMARK_FEEDBACK_FROM_EMAIL ?? 'support@stopapplyingblind.com',
  To: 'support@stopapplyingblind.com',
  ReplyTo: replyOk ? coach.email : 'noreply@stopapplyingblind.com',
  Subject: `[SIGNAL Feedback] [${typeLabel}] from ${coach.name}`,
  TextBody: renderTextTemplate(...),
  HtmlBody: renderHtmlTemplate(...),
  MessageStream: 'outbound',  // or whatever stream exists for transactional
  Tag: 'beta-feedback',
});
```

**Type label mapping** (for human-readable subject lines):

```
issue_bug          → 'Issue/Bug'
enhancement        → 'Enhancement'
technical_question → 'Technical Question'
general_feedback   → 'General Feedback'
other              → 'Other'
```

**Severity label mapping:**

```
blocker → 'Blocker'
high    → 'High'
medium  → 'Medium'
low     → 'Low'
```

**Failure modes handled:**

- Postmark API timeout — caught, logged, `email_sent: false` returned
- Invalid From/To address — caught at startup (verification check in Postmark dashboard)
- Postmark rate limit — caught, logged; not expected at beta volume

### 6.4 Frontend — Feedback button in sidebar nav

**Location:** `components/coach/CoachSidebar.tsx` (or wherever the COACHES CENTER nav group is rendered)

**Placement:** Below "Prospects" item in the COACHES CENTER nav group. New item:

```
COACHES CENTER
  Dashboard
  My Clients
  My Prospects
  Required Actions
  Feedback        ← new (at bottom)
```

The nav uses "My Prospects" (not "Prospects") per current code.
Feedback goes at the bottom of the COACHES CENTER nav group.

**Icon:** None. The Feedback nav item is text-only to match existing
nav items, which do not use icons. `lucide-react` is not installed
in the project and adding it for one icon creates visual
inconsistency (only Feedback would have an icon; other items would
not).

Adding icons to the entire nav is a separate design decision outside
v0.1 scope.

**Visibility:** Always visible to authenticated coaches (`is_coach = true`). Hidden from clients (matches existing nav gating).

**Click behavior:** Opens the slide-in panel (does NOT navigate to a new route). The slide-in is a modal overlay; the underlying page stays mounted so the coach returns to their context after dismissing.

**Implementation note:** Every other COACHES CENTER nav item is an
`<a href>` that navigates. The Feedback item is a `<button>` (or
similar action element) that opens the global SlideInPanel.

The sidebar component currently renders only `<a href>` patterns;
the Feedback item requires a button/action variant. CC should extend
the nav component to support both link items and action items, OR
render the Feedback item with a different markup pattern (button
styled to match link appearance).

### 6.5.0 Slide-in infrastructure

The codebase does NOT have a reusable slide-in component as of
2026-05-27. The only existing slide-in is `AddNotePanel.tsx` — a
page-local one-off that hardcodes its own backdrop and panel.

For v0.1, this FRD ships a NEW generic `<SlideInPanel>` component
(location: `components/ui/SlideInPanel.tsx` or similar) used for the
feedback feature. The existing `AddNotePanel.tsx` is NOT refactored
to use it — that's a separate cleanup ticket out of v0.1 scope.

This means two slide-in patterns coexist after v0.1 ships:
- `AddNotePanel` (page-local, hardcoded) — used by Notes tab
- `SlideInPanel` (generic, reusable) — used by feedback, future features

Trade-off accepted: short-term code duplication for zero-regression
risk to existing Notes tab functionality. Refactor candidate for a
future cleanup pass.

The new `SlideInPanel` must be mounted in the global layout at
`app/dashboard/layout.tsx` (already "use client" with isCoach + token
plumbing), not page-local. This enables the feedback button to open
from any coach page consistently.

### 6.5 Frontend — slide-in panel component

**Location:** `components/coach/FeedbackSlideIn.tsx` (new file)

**Render structure:**

```tsx
<SlideInPanel open={open} onClose={handleClose} side="right" width="md">
  {state === 'form' && (
    <FeedbackForm
      onSubmit={handleSubmit}
      onCancel={handleClose}
      submitting={submitting}
      error={submitError}
    />
  )}
  {state === 'confirmation' && (
    <FeedbackConfirmation onClose={handleClose} />
  )}
</SlideInPanel>
```

**State management:**

```tsx
const [state, setState] = useState<'form' | 'confirmation'>('form');
const [submitting, setSubmitting] = useState(false);
const [submitError, setSubmitError] = useState<string | null>(null);

const handleSubmit = async (formData: FeedbackFormData) => {
  setSubmitting(true);
  setSubmitError(null);

  try {
    const response = await fetch('/api/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        ...formData,
        page_url: window.location.href,
        user_agent: navigator.userAgent,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message ?? 'Submit failed');
    }

    setState('confirmation');
  } catch (err) {
    setSubmitError(err instanceof Error ? err.message : 'Submit failed');
  } finally {
    setSubmitting(false);
  }
};
```

**Form component** (`FeedbackForm`):
- Type radio group or select
- Severity radio group (conditionally rendered when type === 'issue_bug')
- Body textarea with character count
- Reply OK checkbox (default checked)
- Submit button (disabled while submitting or while validation fails)
- Cancel button (closes slide-in)
- Error banner above Submit when submitError !== null

**Confirmation component** (`FeedbackConfirmation`):
- Heading: "Thanks — we got it."
- Body paragraph: "We'll reply within 1-2 business days if you asked us to. You can keep working — we'll find you."
- Close button (only action)

### 6.6 Error handling

| Failure mode | User-facing behavior | System behavior |
|---|---|---|
| Validation error (type missing, body too short, severity mismatch) | Form-level inline error message; Submit button stays disabled | 400 returned; no DB write |
| Network failure during submit | Error banner: "Something went wrong on our end. Please try again or email us directly at support@stopapplyingblind.com." | No state change; coach can retry |
| Auth failure (token expired) | Redirect to sign-in (existing pattern) | 401 returned |
| DB insert failure | Same as network failure — error banner with email fallback | 500 returned, logged with stack trace |
| Postmark send failure | NONE — coach sees confirmation as if successful | Row committed; `email_send_error` populated; ops alerts via Vercel logs |
| Coach not actually a coach (`is_coach = false`) | Feedback button shouldn't appear, but if URL is hit directly: error toast "Feedback is currently available to coaches only" | 403 returned |

---

## 7. Implementation phases

### Phase 1: Schema and infrastructure

1. Create `supabase/migrations/20260527_beta_feedback.sql`
2. Apply to dev via Supabase SQL Editor (Foundation Risk 6 workaround)
3. Verify table exists with CHECK constraints firing, indexes present, trigger attached
4. Create `lib/email/sendFeedbackNotification.ts` with Postmark wiring
5. Create `lib/email/feedbackTemplate.ts` (or inline in sendFeedbackNotification) for template rendering

### Phase 2: API endpoint

1. `app/api/feedback/route.ts` — POST handler
2. Auth via existing `getAuthedProfileText` pattern
3. `is_coach` gate
4. Input validation (type enum, severity-bug coupling, body length)
5. DB insert
6. Email send (non-fatal)
7. Email status writeback
8. Response

### Phase 3: Frontend — slide-in component

1. `components/coach/FeedbackSlideIn.tsx` — main component
2. `components/coach/FeedbackForm.tsx` — form sub-component
3. `components/coach/FeedbackConfirmation.tsx` — confirmation sub-component
4. Wire to existing slide-in panel infrastructure (if any) OR create one if none exists
5. State management + form validation
6. Submit handler + error handling

### Phase 4: Frontend — sidebar nav integration

1. Add Feedback item to COACHES CENTER nav group
2. Wire click handler to open slide-in
3. Verify gating on `is_coach`
4. Verify the slide-in works from every coach page (Dashboard, Required Actions, My Clients, Prospects, Client Dashboard, all tabs)

### Phase 5: Testing and verification

1. Unit tests for input validation logic
2. Integration test for POST endpoint (auth + validation + DB write + email send)
3. End-to-end test as Peri's dev coach account:
   - Submit one of each type
   - Verify rows in `beta_feedback` table
   - Verify emails arrive at `support@stopapplyingblind.com`
   - Verify Reply-To is correct (coach email vs noreply)
   - Verify confirmation UX
   - Verify error states (offline, bad input)
4. Verify Erin can also submit from her dev coach account
5. Manual verification: both you and Erin receive forwarded emails at personal inboxes

---

## 8. Testing strategy

### Unit tests

- Input validation: type enum, severity-bug coupling, body length, reply_ok type
- Email template rendering: friendly labels, optional fields handled, Reply-To logic

### Integration tests

- POST /api/feedback end-to-end:
  - Authenticated coach submits valid feedback → 201, row created, email queued
  - Unauthenticated → 401
  - Non-coach (`is_coach = false`) → 403
  - Invalid type → 400
  - Bug type without severity → 400
  - Non-bug type WITH severity → 400
  - Body too short → 400
  - Body too long → 400
  - DB failure simulated → 500
  - Postmark failure simulated → 201 with `email_sent: false`

### End-to-end tests

- Peri's dev coach account submits each of 5 types
- Verify all 5 rows in `beta_feedback`
- Verify all 5 emails received at `support@stopapplyingblind.com`
- Verify Reply-To header on each (coach email when reply_ok=true)
- Verify confirmation UX displays correctly
- Verify slide-in dismisses cleanly
- Test pause-and-resume not relevant (no draft saving in v0.1)

### Regression tests

- Coach routes still work (no schema collision)
- Client routes still work (no impact)
- Existing Postmark sends (sendClientInvite, etc.) still work
- Sidebar nav rendering unaffected for non-coach users

### Manual validation

- You submit feedback from dev as your coach account, verify email arrives at `support@stopapplyingblind.com`, verify forwarding to personal works, verify Reply-To threads correctly when you reply
- Erin submits feedback from dev as her coach account, same verification
- Submit a "Bug" with Blocker severity, verify subject line and email body reflect both
- Submit "Reply OK = false" feedback, verify Reply-To is noreply@ (not coach email)

---

## 9. Risks and mitigations

### Risk: Postmark send failures leave coach thinking feedback wasn't received

**Impact:** Coach submits feedback, sees confirmation, but Postmark fails to send. You/Erin never see it. Coach assumes you got it and is frustrated when you don't respond.

**Mitigation:**
- Row is committed BEFORE email send — `beta_feedback` table is source of truth
- `email_send_error` column captures failure for debugging
- Manual review of rows where `email_sent_at IS NULL` should be an operational practice (weekly during beta)
- If volume grows, add a retry mechanism or admin alert (v0.2)

### Risk: Spam or abuse from compromised coach account

**Impact:** If a coach's session token is compromised, attacker could fire unlimited feedback submissions filling your inbox.

**Mitigation:**
- Rate limit at endpoint level (e.g., 10 submissions per coach per hour)
- Implementation: simple in-memory counter or a Postgres-backed rate limit table
- Honest assessment: at beta scale this is unlikely; can defer rate limiting if implementation is non-trivial
- Long-term: same rate limit pattern would apply when v0.2 opens to clients (where abuse is more likely)

### Risk: Coach submits sensitive client info in feedback body

**Impact:** A coach might paste a client's name, email, or other PII when reporting a bug. That data lands in `beta_feedback` and in your email inbox.

**Mitigation:**
- Form placeholder text doesn't encourage pasting client info
- Standard data handling applies — `beta_feedback` rows are protected by same access controls as other tables
- Email inbox is shared between you and Erin only (forwarding rules)
- v0.2 admin UI should respect this and not expose feedback bodies in unauthorized contexts

### Risk: page_url captures sensitive query parameters

**Impact:** If a URL contains tokens, magic-link codes, or session IDs in query params, they'd be captured in `page_url` and emailed.

**Mitigation:**
- Frontend strips sensitive query params before capturing `page_url` (allowlist of param names to preserve; everything else stripped or redacted)
- Specific strip list: any param matching `token|auth|key|secret|password|code` (case-insensitive)
- Server-side double-check: same strip applied server-side as defense-in-depth

### Risk: Coach hits Feedback button on every page expecting it to navigate

**Impact:** UX confusion if coach expects the Feedback button to take them somewhere, not open a slide-in.

**Mitigation:**
- Visual treatment differentiates the Feedback button from navigation items (e.g., subtly different styling, or grouped under a "Help" sub-section)
- The slide-in itself is unambiguous (clearly modal, clearly a form)
- Worst case: coaches learn the pattern after first use

### Risk: Email-on-insert pattern becomes unmanageable at higher volume

**Impact:** Beyond beta scale (50+ coaches), email-only triage becomes noise. Need an admin UI.

**Mitigation:**
- v0.1 is explicit beta infrastructure, not production at scale
- `status` column already in schema for v0.2 admin UI
- Trigger to revisit: when feedback volume exceeds ~10/week sustained, or when adding 6th+ coach

---

## 10. Dependencies

### Blocks

- v0.2 admin UI (in-product triage with status updates visible to coaches)
- v0.2 client access (same schema/endpoint, gate removed)
- Future user-initiated email features that follow the same row-triggers-email pattern

### Blocked by

- **Postmark domain verification for `stopapplyingblind.com`** — ✅ confirmed complete
- **`support@stopapplyingblind.com` mailbox** — Peri setting up (GoDaddy Workspace Email)
- **GoDaddy forwarding rules** — Peri configuring (forward to personal + Erin's)
- **`is_coach` flag on `client_profiles`** — exists in production
- **Existing Postmark wiring** — verified working via `sendClientInvite`
- **`set_updated_at()` trigger function** — exists in production
  (verified via Foundation runlog DD-07); needs explicit dev-side
  verification before applying the migration. CC's Phase 1 (schema
  migration) should confirm with a one-line query before applying
  the migration:

  ```sql
  SELECT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at'
  );
  ```

### External dependencies

- **Postmark API** — already integrated, no new infrastructure
- **GoDaddy Workspace Email** — out of code path; only matters for email reception, not application logic
- **Supabase auth + RLS** — same patterns as other coach endpoints

---

## 11. Operational constraints

### Dev-only by default

All work ships to dev environment first. Production promotion is a separate explicit step requiring Peri approval. The `beta_feedback` table migration applies to dev via SQL Editor (Foundation Risk 6) before any production work.

### Feature flag rollout

Not strictly necessary in v0.1 (beta-only feature, no public exposure), but recommended pattern:
- Build behind `FEEDBACK_ENABLED=true` env var
- Default false in production until you're ready to open to coaches
- Set true in dev from day one for testing

### Operational pattern for feedback triage

Established as part of this ship:
1. New feedback arrives → email at `support@stopapplyingblind.com` → forwarded to you and Erin
2. Whichever of you sees it first acknowledges by reply (if reply_ok=true)
3. Bug type → file ticket, schedule fix
4. Enhancement → log to a backlog (your existing one or a new lightweight doc)
5. Technical Question → reply with answer
6. General Feedback → reply with thanks
7. Other → judgment call

This is intentionally lightweight in v0.1. v0.2 admin UI can formalize.

### Rollback plan

- `beta_feedback` table can be dropped (no other tables FK to it)
- POST `/api/feedback` route can be removed
- Sidebar nav reverts to pre-feedback state
- Coaches see the feedback option disappear but no data is lost (rows preserved)
- Email forwarding rules at GoDaddy unaffected

---

## 12. Open questions

1. **Rate limiting** — defer to v0.2 unless we expect abuse? Default: defer.
2. **Frontend slide-in infrastructure** — does an existing slide-in component exist (per Notes tab's "slide-in Add Note panel" reference in the runlog) or do we need to build one? If exists, reuse; if not, build a small generic component.
3. **Reply-To noreply address** — does `noreply@stopapplyingblind.com` exist or need to be created? Could also omit Reply-To entirely when `reply_ok=false` (then replies go to From which is `support@stopapplyingblind.com`, which loops back to you/Erin anyway). Lean: omit Reply-To when `reply_ok=false`; simpler.
4. **Email send for `reply_ok=false` submissions** — same content, just different Reply-To. Confirm this is the intended behavior (you/Erin still see the feedback; the noreply just signals "don't expect a response from this person").
5. **Active client count semantics** — defined in §6.2 as `coach_clients` rows where `status='active' AND lifecycle_status IN ('Active', 'Inactive')`. Worth confirming Prospects are intentionally excluded (they should be — counting prospects as "active clients" would inflate the signal).
6. **What if a coach has zero clients?** Active client count = 0. Email still fires correctly. Worth a one-line check that the template handles 0 cleanly (no off-by-one).
7. **Markdown / formatting in body** — accept plain text only in v0.1 (no parsing, no rich text). Coach can paste URLs; the email client will linkify them automatically.

---

## 13. v0.1 ship plan

Target: coach-only beta feedback, end-to-end functional in dev.

Build order:
1. Schema migration applied to dev
2. POST `/api/feedback` endpoint with auth + validation + DB write
3. Postmark wiring (`sendFeedbackNotification` utility)
4. Email writeback to row (`email_sent_at`, `email_send_error`)
5. Frontend slide-in component (form + confirmation states)
6. Sidebar nav Feedback item + click handler
7. End-to-end testing as Peri's dev coach
8. End-to-end testing as Erin's dev coach
9. Manual verification: both inboxes receive forwarded emails

Estimated CC time: half a day to a day. Critical-path item is the slide-in component if no existing slide-in infrastructure exists — that's where uncertainty is highest.

---

## 14. Acceptance criteria

Beta Feedback v0.1 is complete when:

- ✅ `beta_feedback` table exists in dev DB with all columns + indexes + trigger
- ✅ POST `/api/feedback` endpoint exists and passes integration tests
- ✅ Coach-only gate works (`is_coach = false` → 403)
- ✅ Input validation rejects invalid type, missing severity on bugs, severity on non-bugs, body too short/long
- ✅ Row inserts on valid submission with all auto-captured context
- ✅ Postmark email fires within seconds of submission to `support@stopapplyingblind.com`
- ✅ Email subject line includes type and coach name
- ✅ Email body includes all submission details + active client count + Supabase row link
- ✅ Reply-To header set to coach email when `reply_ok=true`; noreply or omitted when `reply_ok=false`
- ✅ `email_sent_at` and `email_send_error` populated correctly
- ✅ Feedback button visible in COACHES CENTER sidebar nav for coaches only
- ✅ Slide-in opens from button click, renders form, validates input, submits, shows inline confirmation
- ✅ Confirmation does NOT auto-close (coach explicitly dismisses)
- ✅ Error states handle network failure with email fallback messaging
- ✅ Submit from each of 5 types succeeds end-to-end with correct email rendering
- ✅ No regressions in existing coach routes or client routes
- ✅ Internal testing completed in dev by both Peri and Erin

Production promotion requires separate Peri approval.

---

## 15. References

- **Coaches Center build snapshot:** `docs/signal-build-snapshot.md`
- **Foundation runlog:** `docs/Features/foundation-migration-runlog.md`
- **Coaches Center Prospects FRD:** `docs/Features/coaches-center-prospects-frd.md` (pattern reference for slide-in + notes infrastructure)
- **Existing Postmark integration:** `lib/email/sendClientInvite.ts` (pattern reference for `sendFeedbackNotification`)
- **`client_profiles.is_coach` gate:** existing in production
- **`coach_clients` table:** existing in production (used for active client count query)
