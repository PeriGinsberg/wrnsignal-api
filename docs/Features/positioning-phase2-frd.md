# FRD: Positioning v2 — Phase 2 (Resume Reframing Workflow)

**Feature ID:** [Assigned by PM]
**Category:** JobFit Engine
**Release:** Positioning v2
**Status:** Draft — awaiting Peri approval
**Author:** Peri Ginsberg + Claude (design conversation 2026-05-16)
**Date:** 2026-05-16

**Design reference:** `C:\Users\perig\wrnsignal-api\docs\positioning-design-reference-v2.md`
**Depends on:** Positioning Foundation FRD, Positioning Phase 1 FRD

---

## 1. Context and motivation

Phase 1 (case_determination + positioning surface) tells the user where they stand — well-positioned, needs targeted changes, or fundamental rebuild. Every Phase 1 case render currently ends with a disabled "Phase 2 coming soon" CTA. Phase 2 is the actual workflow that replaces that placeholder with deliverable resume changes.

Phase 2 is the core product value. Phase 1 surfaces the gap; Phase 2 closes it. Without Phase 2, SIGNAL's value proposition is "we told you what's wrong with your resume." With Phase 2, the value is "we helped you fix it without compromising your integrity."

**Core principle: Reframing, not generation.**

Phase 2's job is to help college students recognize that the work they've already done IS the skill the target role is asking for, even when the words are different. College students are literal — they think "I did a class project," not "I conducted a stakeholder analysis." SIGNAL bridges this gap by reading their resume + the JD, identifying skill-translations they missed, and asking targeted questions grounded in their actual experience.

**Interview integrity is non-negotiable.**

Every claim, bullet, and skill on the revised resume must trace back to user-confirmed experience or text the user typed. SIGNAL never adds claims the user cannot defend in an interview. The product positioning: "SIGNAL helps you build a resume that gets the interview AND sets you up to win it. We won't help you fake anything you can't defend in a room."

Phase 2 establishes patterns subsequent product work inherits:
- The phase2_runs data model and JSONB state persistence pattern
- The "evidence-grounded generation" prompt contract for all future AI-assisted resume work
- The non-linear, user-driven section workflow (selection screen → per-item drilldown → return)
- The persona-save handoff that integrates Phase 2 output back into the user's reusable asset library

---

## 2. Goals and non-goals

### Goals

1. Replace "Phase 2 coming soon" CTA placeholders with functional reframing workflow
2. Implement selection screen showing all recommended changes; user chooses where to start (non-linear workflow)
3. Implement section-by-section side-by-side comparison view (original left, revised right)
4. Implement three interaction patterns: Pattern A — headline reframe (SIGNAL generates options, user picks); Pattern B — bullet reframe (SIGNAL asks question grounded in resume, user answers, SIGNAL drafts); Pattern C — gap discussion (SIGNAL asks probing question, user provides facts, SIGNAL drafts)
5. Implement accept/decline/edit/skip controls per recommendation
6. Implement persona save at workflow completion (user can choose to save revised resume as a new persona)
7. Implement full state persistence — user pauses and resumes exactly where they left off
8. v0.1 ship target: Case B path only, all interaction patterns active

### Non-goals (v0.1)

- Case A and Case C workflows (build after Case B is validated with real users)
- Downloadable docx output (deferred — primary deliverable is side-by-side view; download is v0.2+)
- Cross-run Phase 2 dashboard (per-run scope only; expand if usage patterns reveal need)
- Coach-side intervention UI within Phase 2 (Coaches Center handles wraparound; Phase 2 itself is unified for D2C + coaching)
- Cover Letter handoff (revised resume consumption by Cover Letter tab deferred to v0.2+ — Phase 2 v0.1 ships standalone, validating the reframing workflow before wraparound integration adds scope)
- Bullet quality polish on the upstream JobFit scorer (separate session)
- Filtering "low-impact recommendations" at the scorer level (related but separate from Phase 2 scope)
- Automatic re-scoring against JobFit after revised resume is saved (interesting future work; out of scope here)
- Bulk-accept or bulk-decline UI (every item is per-decision in v0.1)

---

## 3. Scope

This FRD covers:

1. **`phase2_runs` table** (new schema, per-positioning-run scope)
2. **Five API endpoints under `/api/positioning/v2/phase2/*`** (start, get, draft, decide, complete)
3. **Three AI integration paths** (headline option generation, bullet reframe drafting, gap discussion drafting) — each with grounding constraints and server-side validation
4. **State persistence model** (every interaction writes to phase2_runs.state JSONB)
5. **Phase 2 frontend** — selection screen, per-section workflow per interaction pattern, side-by-side comparison view, completion + persona save UX
6. **Case B path end-to-end** as the v0.1 ship boundary

All deliverables ship to dev environment first. Production promotion is a separate explicit step requiring Peri approval. Cases A and C are out of v0.1 — frontend gates Case A and Case C users out of Phase 2 entry (existing Phase 1 CTAs for those cases remain disabled in v0.1).

---

## 4. Design principles

### 4.1 Reframing, not generation

SIGNAL's primary function is translation guidance:
- Recognize work the user has already done that maps to JD requirements
- Surface the connection through targeted questions
- Help the user articulate the connection in JD-appropriate language

SIGNAL does NOT:
- Invent experience the user doesn't have
- Inflate metrics or claims
- Generate bullets describing skills the user hasn't demonstrated
- Manufacture certifications, projects, or accomplishments

### 4.2 Interview integrity

Every accepted resume change must be traceable to:
- Content already present in the original resume, OR
- Text the user typed in response to a Phase 2 prompt

If neither condition is met, the change is not eligible for inclusion in the revised resume. Headlines (Pattern A — generated by SIGNAL) are constrained to evidence-grounded options.

The grounding constraint is enforced in two places:
1. **Prompt-level:** every AI prompt explicitly restricts source content to (a) original resume_text and (b) user_typed_text for the current item.
2. **Server-side validation:** the draft generation endpoint post-processes the model output and rejects drafts that introduce facts not present in the allowed source set. Implementation detail in §6.8.

### 4.3 No filler recommendations

SIGNAL only surfaces changes that make a considerable difference to the resume's fit. If a change is cosmetic, marginal, or recommendation-for-its-own-sake, it is not surfaced. A user with 0-1 items to address is a successful Phase 2 outcome, not a failed one.

"Considerable difference" means:
- Likely to change the JD-fit score by a meaningful margin (specific threshold to be tuned with data)
- OR addresses a specific item the JD explicitly requires that the resume doesn't mention
- OR fundamentally changes the framing of the user's experience for this role

NOT:
- Passive voice fixes
- Slight phrasing tweaks
- Formatting nits
- Polish for polish's sake

The selection screen is allowed to be empty or single-item. Filler items hurt trust more than they help completion rates.

### 4.4 User agency

User can:
- Accept a recommendation
- Decline a recommendation
- Edit SIGNAL's draft before accepting
- Skip a section entirely
- Save their revised resume as a new persona or discard it
- Return to completed sections to revise their decisions
- Write their own draft if SIGNAL's draft can't be generated or grounded — manual override is always available, and user-typed content bypasses grounding validation (the user is personally vouching for it)

User cannot be locked into any change. Skip-and-decline is a feature.

### 4.5 Time discipline

Maximum target: 15 minutes from selection screen to "save as persona" offer. Most Phase 2 work is text editing, metric addition, light reorganization — not content creation. SIGNAL does the cognitive lift; the user verifies and selects.

Implications for design:
- AI generation latency budgets — each draft call should complete within the user's working tempo (target: < 5s p50)
- Prompt design optimized for one-shot drafts that don't require regeneration in most cases
- Selection screen ordering surfaces highest-impact items first so users who quit early still get the most value (ordering open question — see §12.4)

---

## 5. User flow

### 5.1 Entry

User arrives at Phase 2 from one of:
1. Clicking the Phase 1 CTA ("Let's start" — now functional; was "Let's start — Phase 2 coming soon" placeholder)
2. Returning to a previously started Phase 2 session via Job Tracker
3. (Future) Direct deep link from email/notification

Phase 2 entry is gated to Case B users in v0.1. Case A and Case C users see the existing Phase 1 disabled-CTA experience until those paths ship.

### 5.2 Selection screen

First screen the user sees in Phase 2. Shows:
- Summary header: "Here's what we recommend you address for this role"
- List of recommended items, each as a card or row:
  - Item type (Headline, Bullet, Gap)
  - Brief description ("Reframe headline for Product Marketing language")
  - Status indicator (Not started / In progress / Accepted / Declined)
- User clicks an item to enter that section

Item sources (populated at phase2_run creation time):
- Headline recommendation: derived from case_specific + JD signals (always 0 or 1)
- Bullet recommendations: derived from risks + JD bullet expectations (0-N)
- Gap recommendations: derived from risks where the gap can be addressed via reframing (0-N)

If 0 items: user shouldn't be in Phase 2 (Case A pure path); selection screen explains "You're well-positioned — just go apply" and routes to apply CTA. In v0.1 this branch is unreachable because Case A users are gated out of Phase 2; the empty-state copy ships for forward compatibility.

### 5.3 Section workflow (per item)

Three interaction patterns by item type. Patterns B and C share the same underlying interaction primitive (SIGNAL asks question → user answers → SIGNAL drafts) but are applied to different item types with different prompt content.

**Headline (Pattern A):**
- Display: current headline + JD target context
- SIGNAL generates 1-3 reframed headline options grounded in resume evidence
- User: pick one / regenerate / type override / decline
- On accept: revised headline replaces original in the side-by-side right column

**Bullet (Pattern B):**
- Display: the original bullet that needs reframing + the JD context that motivated the recommendation
- SIGNAL asks targeted question grounded in the bullet content (e.g., "You mentioned 'led a class project.' What was the specific outcome, and what tools did you use?")
- User types response (2-4 sentences)
- SIGNAL drafts a reframed bullet from user's response
- User: accept / edit / regenerate / decline
- On accept: revised bullet replaces original in the side-by-side right column

**Gap (Pattern C):**
- Display: the gap (e.g., "JD asks for Excel proficiency; resume doesn't mention it")
- SIGNAL formulates probing question grounded in resume evidence (e.g., "I see you did a full analysis of XYZ — what tools did you use?")
- User types response (2-4 sentences) OR skips ("I genuinely don't have this experience")
- If response: SIGNAL drafts new bullet/skill addition from response
- User: accept / edit / regenerate / decline
- On accept: revised resume gains the new content

In all three patterns, the regenerate action re-invokes the draft endpoint with the same item state. The user's typed response (for Patterns B and C) is preserved across regenerations — they don't have to retype.

### 5.4 Side-by-side comparison

While in a section, the user sees:
- Left: original resume section
- Right: revised resume section (updates as user accepts changes)

When a section completes (user accepts or declines all items in it), the section collapses to a summary row in the selection screen. User returns to selection screen, picks next section.

The side-by-side view scrolls in sync where layout permits. Acceptance immediately updates the right column; decline leaves the right column unchanged. Edits the user makes inline (before clicking accept) update the right-column preview live but only persist on accept.

### 5.5 Workflow completion

User completes all selected items (or chooses "I'm done" partway):
- Offered: "Save this as a new persona?"
- If accept: prompted to name the new persona (default: derived from JD/role context, e.g., "Catherine — Product Marketing")
- New entry in client_personas table with revised resume_text
- If decline: revised resume exists scoped to this positioning_run (viewable, but not reusable)
- Either way: positioning_run marked complete, user lands back on Phase 1 surface with success state

phase2_runs.status transitions to 'completed' at this point regardless of persona save choice. The revised_resume_text field is always populated on completion; new_persona_id is populated only if the user opted to save.

### 5.6 Pause and resume

User can navigate away from Phase 2 at any point. All state persists:
- Which items have been accepted / declined / skipped
- In-progress draft text per item
- User's typed responses (Patterns B and C) preserved
- Position in the workflow (which section was open — state.current_section_id)

User returns to Phase 2 via Job Tracker → opens the positioning_run → Phase 2 picks up exactly where they left off. The state.current_section_id field re-opens that section if it's still in_progress; otherwise drops them on the selection screen.

If the user is offline mid-edit (Pattern B or C typing) and their last interaction was not persisted, they lose only the unsubmitted draft text. Accepted/declined items are always persisted before the user moves on.

---

## 6. Technical design

### 6.1 Data model — `phase2_runs` table

Persists Phase 2 state per positioning_run. One row per (positioning_run_v2, client_persona) — re-entering Phase 2 with a different persona creates a new phase2_run.

```sql
CREATE TABLE phase2_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  positioning_run_id UUID NOT NULL REFERENCES positioning_runs_v2(id) ON DELETE CASCADE,
  client_profile_id UUID NOT NULL REFERENCES client_profiles(id),
  client_persona_id UUID NOT NULL REFERENCES client_personas(id),
  case_letter TEXT NOT NULL CHECK (case_letter IN ('A', 'B', 'C')),

  -- Workflow state (full session JSONB; see §6.3 for schema)
  state JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Composed revised resume — updated on every accept/edit
  revised_resume_text TEXT,

  -- Persona save (NULL until user completes + opts to save)
  new_persona_id UUID REFERENCES client_personas(id),

  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (
    status IN ('in_progress', 'completed', 'abandoned')
  ),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_phase2_runs_positioning_run ON phase2_runs(positioning_run_id);
CREATE INDEX idx_phase2_runs_profile ON phase2_runs(client_profile_id);
CREATE INDEX idx_phase2_runs_status ON phase2_runs(status);

CREATE TRIGGER update_phase2_runs_updated_at
  BEFORE UPDATE ON phase2_runs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

Migration applies to dev first via the standard Supabase SQL Editor workaround per Foundation Risk 6 (dev migration tracker drift; see Foundation runlog).

### 6.2 Item population from `positioning_run_v2`

On phase2_runs creation, items are populated from the parent positioning_run_v2 row:

- **Headline item:** derived from positioning_run_v2.case_specific.headline_recommendation if present. Maximum 1 headline item per run.
- **Bullet items:** derived from positioning_run_v2.result_json or upstream jobfit_run.result_json risks tagged as "bullet-addressable" (specific filter logic in §6.3 implementation note).
- **Gap items:** derived from risks where the gap maps to a JD requirement and the resume has adjacent-but-unsurfaced evidence.

The filter that decides "this risk surfaces as an item" enforces design principle §4.3 (no filler). Specific filter rules:

- **Surface if:** risk severity is `high` OR risk score-impact (if computable) exceeds threshold (initial value: 5 points, tunable per §12.1)
- **Skip if:** risk is purely cosmetic (no associated JD requirement), is a formatting nit, or was already addressed by a prior accepted item

Item ordering on the selection screen is an open question (§12.4). v0.1 default: headline first, then bullets ordered by impact (desc), then gaps ordered by impact (desc).

### 6.3 `state` JSONB schema

Illustrative shape. The TypeScript type lives in `lib/positioning/v2/phase2/types.ts` (to be created):

```json
{
  "items": [
    {
      "id": "headline-1",
      "type": "headline",
      "label": "Reframe headline for Product Marketing language",
      "original": "Marketing Intern with passion for brands",
      "draft_options": [
        "Product Marketing Intern with experience translating user research into positioning",
        "Marketing Intern focused on product narrative and competitive analysis"
      ],
      "selected_draft_index": null,
      "user_override_text": null,
      "accepted": false,
      "declined": false,
      "skipped": false,
      "manual_entry": false,
      "decided_at": null
    },
    {
      "id": "bullet-1",
      "type": "bullet",
      "label": "Reframe class project bullet for outcome + tools",
      "original_bullet": "Led a class project on consumer research",
      "jd_context": "JD asks for stakeholder analysis and tool fluency",
      "question_asked": "You mentioned 'led a class project.' What was the specific outcome, and what tools did you use?",
      "user_response": null,
      "draft": null,
      "accepted": false,
      "declined": false,
      "skipped": false,
      "manual_entry": false,
      "decided_at": null
    },
    {
      "id": "gap-1",
      "type": "gap",
      "label": "Address missing Excel proficiency",
      "gap_description": "JD asks for Excel proficiency; resume doesn't mention it",
      "jd_context": "JD: 'proficient in Excel including pivot tables and VLOOKUP'",
      "question_asked": "I see you did a full analysis of XYZ — what tools did you use?",
      "user_response": null,
      "draft": null,
      "accepted": false,
      "declined": false,
      "skipped": false,
      "manual_entry": false,
      "decided_at": null
    }
  ],
  "current_section_id": "headline-1",
  "selection_screen_seen": true,
  "completion_offered": false,
  "completion_decision": null
}
```

Field semantics:
- `accepted`, `declined`, `skipped` are mutually exclusive boolean states. A null decision = item not yet touched.
- `decided_at` is set when any of accepted/declined/skipped flips to true.
- `manual_entry` flips to true when the user accepted content via the manual-entry-mode flow (§6.9.1) — the draft bypassed grounding validation because the user typed it themselves.
- `selection_screen_seen` flips to true on the first /draft or /decide that returns the selection screen.
- `completion_offered` flips to true when the user hits the "I'm done" or all-items-decided state and is shown the persona save prompt.

### 6.4 State transitions

```
                  ┌──────────────────┐
                  │ in_progress      │ (initial; on phase2_run creation)
                  └────────┬─────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ completed│ │ abandoned│ │ abandoned│
        │ (user    │ │ (user    │ │ (system  │
        │  /complete│ │ closes  │ │  timeout │
        │  endpoint)│ │  without │ │  after   │
        │           │ │  decision│ │  N days) │
        └──────────┘ └──────────┘ └──────────┘
```

- `in_progress` → `completed`: explicit POST /complete call with save_as_persona decision
- `in_progress` → `abandoned`: explicit user-driven abandon (frontend cleanup) or system timeout (30-day inactivity; matches positioning_runs_v2 lifecycle)
- No transitions from `completed` or `abandoned` (terminal states)

Re-entering Phase 2 for the same positioning_run after a `completed` or `abandoned` phase2_run creates a NEW phase2_run with fresh state. Historical phase2_runs are retained for audit and learning.

### 6.5 API endpoints

Five endpoints under `/api/positioning/v2/phase2/*`. All authenticated via the standard Bearer token + `getAuthedProfileText()` pattern (matches Phase 1).

#### 6.5.1 POST /api/positioning/v2/phase2/start

Creates a new phase2_run for the given positioning_run_id. Populates state.items from positioning_run_v2 + upstream jobfit_run data per §6.2.

```typescript
// Request
{
  positioning_run_id: string;  // required
}

// Response (200)
{
  phase2_run_id: string;
  state: PhaseTwoState;        // see §6.3
  status: 'in_progress';
}

// Error responses
// 404 if positioning_run_id not found or doesn't belong to authed profile
// 409 if an in_progress phase2_run already exists for this positioning_run + persona
//     (response includes existing phase2_run_id; client should GET it instead)
// 400 if positioning_run is in Case A or Case C (v0.1 only — gated)
```

The 409 conflict response is the resume-existing-session signal. Frontend transparently redirects to GET on the returned phase2_run_id.

#### 6.5.2 GET /api/positioning/v2/phase2/[id]

Fetches the current phase2_run state.

```typescript
// Response (200)
{
  phase2_run_id: string;
  positioning_run_id: string;
  client_persona_id: string;
  case_letter: 'A' | 'B' | 'C';
  state: PhaseTwoState;
  revised_resume_text: string | null;
  status: 'in_progress' | 'completed' | 'abandoned';
  new_persona_id: string | null;
  created_at: string;     // ISO8601
  updated_at: string;     // ISO8601
  completed_at: string | null;
}

// Error responses
// 404 if phase2_run_id not found or doesn't belong to authed profile
```

GET is idempotent and read-only — it does NOT update `state.selection_screen_seen`. That flag is updated on /draft or /decide calls when the user demonstrably interacts with an item.

#### 6.5.3 POST /api/positioning/v2/phase2/[id]/draft

Generates a draft (headline option, reframed bullet, gap response) for a specific item.

```typescript
// Request
{
  item_id: string;            // required; must reference an item in state.items
  draft_type: 'headline' | 'bullet' | 'gap';
  user_input?: string;        // required for 'bullet' and 'gap'; ignored for 'headline'
  regenerate?: boolean;       // optional; if true, ignores cached draft
}

// Response (200)
{
  drafts: string[];           // 1-3 options for headlines; 1 element for bullets/gaps
  item_id: string;
  generated_at: string;       // ISO8601
}

// Error responses
// 404 if phase2_run_id or item_id not found
// 400 if draft_type doesn't match item type, or user_input missing when required
// 422 if AI grounding validation fails after N retries (see §6.8 + §6.9.1 for downstream UX)
// 429 if per-run AI cost cap exceeded (see §6.12 and §12.7)
```

The /draft endpoint writes the generated drafts back into state.items[item_id].draft_options (headline) or state.items[item_id].draft (bullet/gap). Subsequent GETs reflect the new drafts.

#### 6.5.4 POST /api/positioning/v2/phase2/[id]/decide

User accepts, declines, edits, or skips an item.

```typescript
// Request
{
  item_id: string;
  decision: 'accept' | 'decline' | 'skip';
  edited_text?: string;       // optional; if present and decision='accept', overrides draft
  selected_draft_index?: number; // headline only; which option the user picked
  manual_entry?: boolean;     // optional; true if accept came from manual-entry-mode flow (§6.9.1)
}

// Response (200)
{
  state: PhaseTwoState;
  revised_resume_text: string;   // recomposed after the decision
}

// Error responses
// 404 if phase2_run_id or item_id not found
// 400 if decision invalid, or selected_draft_index out of range
// 409 if item already has a decision (use a separate "revise decision" path; not in v0.1)
```

Decision semantics:
- `accept` without edited_text: uses the draft (or selected_draft_index for headlines) as the final content
- `accept` with edited_text: uses the user's edited version as the final content
- `accept` with manual_entry=true: edited_text is required; flag is recorded for analytics; grounding validation bypassed
- `decline`: marks item declined, no resume change
- `skip`: marks item skipped, no resume change, but distinguished from decline for analytics

After every /decide call, the server recomposes revised_resume_text (see §6.10) and returns the updated state.

#### 6.5.5 POST /api/positioning/v2/phase2/[id]/complete

Finalizes the phase2_run. Optionally creates a new persona.

```typescript
// Request
{
  save_as_persona: boolean;
  persona_name?: string;       // required if save_as_persona=true; max 80 chars
}

// Response (200)
{
  phase2_run_id: string;
  status: 'completed';
  new_persona_id: string | null;
  revised_resume_text: string;
}

// Error responses
// 404 if phase2_run_id not found
// 409 if phase2_run already completed or abandoned
// 400 if save_as_persona=true and persona_name missing or invalid
```

Side effects on success:
- phase2_runs.status → 'completed'
- phase2_runs.completed_at → now()
- positioning_runs_v2.current_phase advances per the Phase 1 FRD's phase progression contract (specifics: phase_data.phase_2 keys populated; details in §6.11)
- If save_as_persona=true: new client_personas row created with resume_text = revised_resume_text and name = persona_name; phase2_runs.new_persona_id is set to the new row's id

### 6.6 Endpoint behavior detail

#### Request lifecycle (POST /draft, Pattern B example)

```typescript
async function handlePhase2Draft(req: Request, id: string): Promise<Response> {
  // 1. Auth
  const profileId = await authenticateProfile(req);

  // 2. Fetch phase2_run + verify ownership
  const run = await getPhase2Run(id);
  if (!run || run.client_profile_id !== profileId) {
    return errorResponse(404, 'not_found', 'Phase 2 run not found.');
  }

  // 3. Validate request
  const { item_id, draft_type, user_input } = parseAndValidate(req);
  const item = run.state.items.find(i => i.id === item_id);
  if (!item) return errorResponse(404, 'item_not_found', 'Item not found in run.');
  if (item.type !== draft_type) {
    return errorResponse(400, 'type_mismatch', 'draft_type does not match item type.');
  }
  if ((draft_type === 'bullet' || draft_type === 'gap') && !user_input) {
    return errorResponse(400, 'user_input_required', 'Patterns B and C require user_input.');
  }

  // 4. Check AI cost cap for this phase2_run (§6.12)
  if (await isCostCapExceeded(run.id)) {
    return errorResponse(429, 'cost_cap_exceeded', 'AI generation cap reached for this run.');
  }

  // 5. Fetch grounding source content
  const persona = await getPersona(run.client_persona_id);
  const positioningRun = await getPositioningRunV2(run.positioning_run_id);

  // 6. Build prompt per §6.7
  const prompt = buildPrompt({
    draftType: draft_type,
    item,
    resumeText: persona.resume_text,
    jobDescription: positioningRun.job_description,
    userInput: user_input,
  });

  // 7. Invoke Claude API (retry on grounding validation failure, max 2 attempts)
  let drafts: string[] | null = null;
  for (let attempt = 0; attempt < 2 && !drafts; attempt++) {
    const raw = await invokeClaude(prompt);
    const validated = validateGrounding({
      raw,
      allowedSources: [persona.resume_text, user_input ?? ''],
    });
    if (validated.ok) {
      drafts = validated.drafts;
    }
  }

  if (!drafts) {
    // Grounding failed after retry. Returns 422; frontend handles via §6.9.1 manual-entry mode.
    await logGroundingRejection(run.id, item_id, prompt, draft_type);
    return errorResponse(422, 'grounding_failed', 'AI generated ungrounded content.');
  }

  // 8. Persist drafts into state
  await updatePhase2RunState(run.id, (state) => {
    const item = state.items.find(i => i.id === item_id);
    if (item?.type === 'headline') {
      item.draft_options = drafts;
    } else if (item) {
      item.draft = drafts[0];
      item.question_asked = prompt.questionAsked;
      item.user_response = user_input;
    }
    state.selection_screen_seen = true;
    return state;
  });

  // 9. Record AI cost usage
  await recordAICost(run.id, attempt + 1);

  // 10. Return drafts
  return successResponse({ drafts, item_id, generated_at: new Date().toISOString() });
}
```

### 6.7 AI integration architecture

Phase 2 uses Claude API for three generation tasks. Implementation lives in `lib/positioning/v2/phase2/aiClient.ts` (to be created), modeled after the existing Haiku bullet generation in `app/api/jobfit/bulletGeneratorV5.ts`.

#### 6.7.1 Headline option generation (Pattern A)

- **Input:** resume_text, JD text, current headline, case_specific recommendation
- **Output:** 1-3 reframed headline options
- **Constraint:** each option must be evidence-grounded — anchored in skills/experience present in resume_text
- **Model:** Claude Haiku (latency + cost optimized; output is short)
- **Token budget:** ~200 output tokens

#### 6.7.2 Bullet reframe drafting (Pattern B)

- **Input:** resume_text, JD text, original bullet, user's typed response
- **Output:** 1 reframed bullet
- **Constraint:** bullet content must use only facts from original bullet + user's typed response
- **Model:** Claude Haiku
- **Token budget:** ~150 output tokens

#### 6.7.3 Gap discussion drafting (Pattern C)

- **Input:** resume_text, JD text, gap description, user's typed response
- **Output:** 1 new bullet or skill addition
- **Constraint:** same as 6.7.2 — only facts from resume + user's typed response
- **Model:** Claude Haiku
- **Token budget:** ~150 output tokens

#### Common contract for all three paths

- **Prompt structure:** system prompt establishes the "no invention" constraint with verbatim language ("You may use only the following source text. Do not introduce facts, metrics, claims, skills, tools, or accomplishments not explicitly present in the source.")
- **Output format:** strict JSON, validated against schema
- **Retry policy:** if AI generates ungrounded content (per §6.8 validation), regenerate up to 1 time; if regeneration fails, return 422 to frontend which transitions to manual-entry mode (§6.9.1) — the user takes over with their own draft
- **Logging:** every AI call logs (phase2_run_id, item_id, draft_type, input_tokens, output_tokens, ms_latency, validation_result) for cost tracking and post-hoc tuning

### 6.8 Prompt structure and grounding validation

#### Prompt skeleton (illustrative — finalize during implementation)

```
SYSTEM:
You are SIGNAL, a resume reframing assistant. Your job is to help users
rephrase their existing experience in language appropriate to the target
job description. You may use ONLY the source text provided. Do NOT
introduce facts, metrics, claims, tools, skills, certifications, or
accomplishments that are not explicitly stated in the source text.

If you cannot produce a draft using only the source text, return
{"draft": null, "reason": "insufficient_source_evidence"}.

USER:
=== SOURCE: Original resume excerpt ===
{resume_text or relevant excerpt}

=== SOURCE: User's typed response ===
{user_input}  // omitted for headlines (Pattern A)

=== TARGET: Job description excerpt ===
{jd_relevant_excerpt}

=== TASK ===
{task-specific instructions per draft_type}

Return strict JSON: { "drafts": ["..."] }
```

#### Grounding validation (server-side)

After the AI returns a draft, validate that the draft contains only facts traceable to allowed sources:

1. Tokenize draft into noun phrases, named entities, numeric claims, tool/skill mentions
2. For each extracted item, check membership in the allowed-source set:
   - Allowed sources for Patterns B and C: original_bullet (or gap_description) + user_input + general competence language
   - Allowed sources for Pattern A (headline): full resume_text + case_specific recommendation framing
3. If any extracted item fails membership, validation returns `{ ok: false, ungrounded: [...] }`
4. Failed validation → regenerate (max 1 retry) → if still failed, return 422 → frontend hands off to manual-entry mode (§6.9.1)

The validator is intentionally conservative — it errs toward rejecting borderline drafts rather than letting ungrounded claims through. Validator implementation detail in `lib/positioning/v2/phase2/groundingValidator.ts` (to be created). Initial implementation uses simple substring + entity overlap heuristics; can be tightened with a small classifier model if false-reject rate is too high (see §11 grounding validator telemetry).

### 6.9 Error handling

| Failure mode | User-facing behavior | System behavior |
|---|---|---|
| AI grounding validation fails after retry | Section UI transitions to manual-entry mode (see §6.9.1 below). Not framed as an error — framed as "Write your own." | Logged with full prompt + raw output for post-hoc tuning; counts toward grounding-rejection telemetry (§11) |
| AI request timeout (>30s) | Inline error: "Generation timed out — please try again." | Logged; counts toward retry budget |
| AI cost cap exceeded for this run | Modal: "You've reached the generation limit for this session. You can still edit drafts manually or save what you've done so far." Edit-text input remains available; further /draft calls return 429. | Cost cap recorded in phase2_runs.state.ai_cost_cap_hit_at |
| Network failure mid-edit | Frontend retries silently on next interaction; client-side state preservation buffers user input | Server-side: no change until next successful call |
| User closes tab mid-typing (Pattern B or C) | Unsubmitted user_response text is lost | All accepted/declined/skipped decisions are persisted before the user moves on |
| phase2_run becomes invalid (e.g., parent positioning_run deleted) | Error page: "This session is no longer available." | Cascade delete on positioning_runs_v2 deletion (per §6.1 ON DELETE CASCADE) |

#### 6.9.1 Manual-entry mode (grounding failure first-class flow)

Grounding validation failure is not an error from the user's perspective — it's a signal that SIGNAL doesn't have enough source material to safely draft for this item. The product response is to hand control to the user, not to apologize.

When validation fails after the retry budget:

1. The section UI transitions into manual-entry mode (no error toast, no "try again" affordance)
2. Copy: "We couldn't draft this one for you with the evidence available. Write your own — you know your experience best."
3. A free-text input is displayed in the section's draft area, pre-populated with the original bullet (for Pattern B) or empty (for Patterns A and C)
4. The user types their own draft and clicks Accept
5. User-typed content bypasses grounding validation entirely — the user is personally vouching for it (this is the §4.4 manual-override principle made concrete)
6. The accepted content flows into revised_resume_text via the same §6.10 composition path

Server-side, manual-entry decisions are recorded in state.items[id] with `manual_entry: true` so post-launch analysis can quantify how often grounding failures route users into manual mode (a key product health metric).

### 6.10 Revised resume composition

After every accept/edit decision, the server recomposes phase2_runs.revised_resume_text by applying accepted items to the original resume_text:

1. Start with persona.resume_text as the base
2. For each item in state.items where accepted=true:
   - Headline: replace the original headline line in the resume with the accepted draft
   - Bullet: locate the original_bullet text in the resume and replace with the accepted draft
   - Gap: append the accepted draft to the appropriate resume section (e.g., new skill → Skills section; new bullet → most-relevant experience section, determined by AI-suggested anchor)
3. Write the result to phase2_runs.revised_resume_text

The composition is deterministic and re-runnable — recomposing from the same state always produces the same output. This lets the UI request a "preview after edit" without persisting intermediate states.

Section-anchor inference for gap items (where to insert new content) is an open question (§12.5). v0.1 default: append to Skills section for skill-type gaps; append to the most-recent experience entry for bullet-type gaps.

### 6.11 Cover Letter handoff (deferred to v0.2+)

Out of v0.1 scope. Cover Letter tab continues to consume the persona's original resume_text (existing behavior, no change). Wiring the revised resume into Cover Letter as a new input source is wraparound integration work that should follow validation that Phase 2 produces useful revised resumes end-to-end.

v0.2 sketch (not committed): Cover Letter tab adds a lookup for the latest completed phase2_run on the current positioning_run; if found, uses phase2_runs.revised_resume_text as the resume input; falls back to persona.resume_text otherwise. Read-only consumption — Phase 2 doesn't write to the Cover Letter tab. Specific lookup contract (which fields, which join path) TBD when v0.2 is scoped.

Bundling Cover Letter wiring into v0.1 was considered and rejected: it adds integration risk, depends on Cover Letter tab code changes, and obscures the v0.1 ship signal (did the reframing workflow itself work?) behind a second moving piece.

### 6.12 AI cost tracking and cap

Each phase2_run accumulates AI call costs (input tokens + output tokens, monetized at current Haiku rates). Cap enforced server-side in /draft endpoint.

- **Per-run cap:** TBD value (§12.7). Initial proposal: $0.50 per phase2_run as a conservative ceiling.
- **Implementation:** new column `phase2_runs.ai_cost_cents` (INTEGER NOT NULL DEFAULT 0) incremented on every /draft call
- **Frontend awareness:** /draft 429 response includes the cap details so frontend can show a clear "you've reached the limit" message rather than a generic error

Cost cap is per-run, not per-user. Users with multiple positioning_runs (e.g., multiple jobs in progress) each get a fresh cap.

---

## 7. Implementation phases

### Phase 2a: Schema and infrastructure

1. Create `phase2_runs` table in dev DB (note: dev DB migration friction per Foundation Risk 6 may require SQL Editor workaround)
2. Add `ai_cost_cents` column to phase2_runs
3. Create `lib/positioning/v2/phase2/types.ts` — PhaseTwoState, PhaseTwoItem, decision types
4. Create `lib/positioning/v2/phase2/itemPopulator.ts` — derives items from positioning_run_v2 per §6.2
5. Create `lib/positioning/v2/phase2/resumeComposer.ts` — recomposes revised_resume_text per §6.10
6. Create `lib/positioning/v2/phase2/aiClient.ts` — Claude API wrapper for the three draft types
7. Create `lib/positioning/v2/phase2/groundingValidator.ts` — post-generation validation per §6.8

### Phase 2b: API endpoints

1. POST `/api/positioning/v2/phase2/start/route.ts`
2. GET `/api/positioning/v2/phase2/[id]/route.ts`
3. POST `/api/positioning/v2/phase2/[id]/draft/route.ts`
4. POST `/api/positioning/v2/phase2/[id]/decide/route.ts`
5. POST `/api/positioning/v2/phase2/[id]/complete/route.ts`
6. Shared error response helpers + auth wiring (matches Phase 1 patterns)
7. AI cost cap enforcement wiring

### Phase 2c: Frontend — selection screen + workflow shell

1. Phase 2 page route (likely `/positioning/v2/[positioning_run_id]/phase2` — coordinate with frontend conventions)
2. Selection screen component (lists items, status indicators, click-through)
3. Workflow shell (header, side-by-side layout container, back-to-selection nav)
4. Empty-state copy for 0-item case (forward compat — not reachable in v0.1)

### Phase 2d: Frontend — interaction patterns

1. Headline section (Pattern A): display original + JD context, list 1-3 generated options, regenerate, type-override, accept/decline
2. Bullet section (Pattern B): display original bullet + JD context, render question, text input for user response, generate draft, accept/edit/regenerate/decline
3. Gap section (Pattern C): same shape as bullet, different prompt content, skip-because-no-experience option
4. Manual-entry mode UI per §6.9.1 (triggered on 422 from /draft)
5. Inline edit interactions for accepted-with-edit flow

### Phase 2e: Frontend — completion + persona save

1. "I'm done" CTA (always visible after selection screen seen)
2. Auto-completion detection (all items accepted/declined/skipped)
3. Persona save modal: name input with default-derived suggestion, save vs. discard choice
4. Post-completion: return to Phase 1 surface with success state

### Phase 2f: Testing and live validation

1. End-to-end testing with test100 + Case B JD scenarios
2. Each interaction pattern verified independently
3. State persistence verified (pause + resume mid-section)
4. Persona save flow verified
5. AI grounding validation verified (synthetic ungrounded outputs rejected, manual-entry mode engages cleanly)
6. AI cost cap enforcement verified
7. Live test with one real client (TBD — Lily Stein or Dimitri Dimitrakis are candidates; both in active interview prep)

---

## 8. Testing strategy

### Unit tests

- `itemPopulator`: given positioning_run_v2 + jobfit_run shapes, emits expected items (with filter rules per §6.2)
- `resumeComposer`: deterministic recomposition; same input always produces same output; handles accept/decline/skip mix correctly
- `groundingValidator`: rejects drafts containing ungrounded entities; accepts drafts using only allowed sources; edge cases (empty user_input, very long resume_text)
- State transition rules (in_progress → completed via /complete; cannot transition from terminal states)
- Item ordering on selection screen

### Integration tests

- `/api/positioning/v2/phase2/start` end-to-end:
  - New phase2_run created for valid positioning_run
  - 404 for invalid positioning_run
  - 409 for already-in-progress phase2_run + persona combination
  - 400 for Case A or Case C positioning_run (v0.1 gate)
- `/api/positioning/v2/phase2/[id]` GET: returns full state; auth enforcement
- `/api/positioning/v2/phase2/[id]/draft`:
  - Headline draft generation (Pattern A): 1-3 options returned
  - Bullet draft generation (Pattern B): user_input required, draft returned
  - Gap draft generation (Pattern C): same shape
  - Regenerate flag bypasses cache
  - 429 returned when cost cap exceeded
  - 422 returned when grounding fails after retry
- `/api/positioning/v2/phase2/[id]/decide`:
  - Accept persists decision + recomposes revised_resume_text
  - Accept with manual_entry=true persists decision with manual_entry flag set
  - Decline persists decision, no resume change
  - Skip persists decision, no resume change, distinct from decline
  - Edited-text accept overrides draft
  - 409 if item already decided
- `/api/positioning/v2/phase2/[id]/complete`:
  - save_as_persona=true creates new client_personas row
  - save_as_persona=false leaves persona unchanged but completes the run
  - Cannot complete an already-completed or abandoned run
  - revised_resume_text is non-null on completion

### AI grounding tests

- Synthetic prompt with ungrounded output → validator rejects
- Synthetic prompt with grounded output → validator accepts
- Edge: AI returns empty draft → handled gracefully
- Edge: AI returns malformed JSON → caught, retried, fails to 422
- Manual-entry mode flow: 422 from /draft → frontend transitions to manual-entry UI → user-typed accept bypasses validator → recorded with manual_entry=true

### Frontend tests

- Selection screen renders all item types correctly
- Status indicators reflect state (not started / in progress / accepted / declined)
- Each interaction pattern: full flow from entry → decision → return to selection (Pattern A headline; Pattern B bullet; Pattern C gap)
- Manual-entry mode UI triggers correctly on 422 and accepts user-typed content
- Side-by-side updates live on accept
- Pause + resume: navigating away and back restores state including in-progress text
- Persona save modal: required-field validation, default suggestion populated
- Cost cap UX: 429 response triggers cap modal with appropriate copy

### Regression tests

- Phase 1 still works (case determination unaffected)
- Cover Letter tab still works (continues to use persona.resume_text — unchanged in v0.1)
- JobFit run creation still works
- v1 Positioning still works
- signal_applications.positioning_run_id linkage unchanged

### Manual validation

- Live test with one real client (post-internal-testing, pre-broader-rollout)
- Sample 5 AI-generated drafts manually for grounding quality before enabling for live users
- Review revised_resume_text for at least 3 Case B scenarios end-to-end

---

## 9. Risks and mitigations

### Risk: AI generates ungrounded content (interview integrity violation)

**Impact:** If SIGNAL generates a claim the user can't defend in an interview, the product positioning is broken and the user is actively harmed. This is the single highest-stakes risk in Phase 2.

**Mitigation:**
- Prompt-level constraint with explicit "do not invent" language (§6.7, §6.8)
- Server-side grounding validation rejects drafts with ungrounded entities (§6.8)
- Retry policy: 1 retry on grounding failure, then 422 routes to manual-entry mode (§6.9.1) where the user takes over
- Manual sampling during dev — review 5+ generated drafts for grounding compliance before enabling for live users
- Grounding rejection telemetry (§11) tracks rejection patterns for post-launch validator tuning
- Long-term: tighten validator with classifier model if false-reject rate is too high

### Risk: AI cost runaway

**Impact:** Without a cap, a user (or a bug) can drive unbounded AI cost via repeated regenerations on multiple items across multiple runs.

**Mitigation:**
- Per-run AI cost cap enforced at /draft endpoint (§6.12)
- Initial cap: $0.50/run (conservative — tunable post-launch)
- 429 response gives the user a clear cap message with manual-edit fallback
- Cost logged per call for post-hoc analysis and cap tuning

### Risk: User abandonment due to time investment

**Impact:** Phase 2's value depends on completion. If the workflow takes too long, users abandon partway and SIGNAL's value proposition (resume changes delivered) doesn't materialize.

**Mitigation:**
- 15-minute target maximum (design principle §4.5)
- Pause/resume so abandonment doesn't lose progress
- Selection screen ordering surfaces highest-impact items first (so partial completion still delivers value)
- "I'm done" CTA always available — user can complete with N items addressed rather than requiring all
- Latency budget on AI calls (target < 5s p50) to keep the working tempo

### Risk: State persistence corruption or loss

**Impact:** User accepts items, navigates away, returns to find accepted items missing or revised_resume_text inconsistent with state.items. Erodes trust.

**Mitigation:**
- State is persisted on every accept/decline/skip (no batched writes that could drop on crash)
- revised_resume_text is recomposed deterministically from state.items on every /decide call — single source of truth is state, not the composed text
- JSONB column allows whole-state writes (atomic update per call)
- Integration test for the pause/resume scenario as a first-class case

### Risk: Filler recommendations slip through despite §4.3

**Impact:** Users see cosmetic items in the selection screen, lose trust ("why are you wasting my time with this?"), abandon.

**Mitigation:**
- Filter rules in §6.2 enforce surface-if-high-impact thresholds
- Selection screen empty/single-item state is acceptable per §4.3 (no padding to N items)
- Post-launch: monitor user feedback on item quality; tune filter thresholds (§12.1)

### Risk: Persona library bloat

**Impact:** Every completed phase2_run with save_as_persona=true creates a new persona. Heavy users could accumulate 50+ personas, making the persona picker unusable.

**Mitigation:**
- Persona save is opt-in (user must click "save as new persona"; default is not to save)
- Default persona name includes JD/role context (reduces unintentional duplicates)
- Future: persona archive/dedupe UI (out of v0.1 scope)
- v0.1 acceptance: persona picker remains usable after 5+ saves (manual test)

### Risk: Grounding validator false-reject rate erodes UX

**Impact:** If the validator is too strict, users frequently hit manual-entry mode for items that SIGNAL could have safely drafted. The product feels like "type your own resume" rather than "we help you reframe." Trust degrades even though no integrity violations occur.

**Mitigation:**
- Manual-entry-mode framing is "Write your own — you know your experience best" (not apologetic; not framed as SIGNAL failure)
- Grounding rejection telemetry (§11) tracks the rejection-rate AND downstream manual-entry-completion-rate as paired metrics
- Validator threshold tuning planned after first 100 rejections (§11)
- If false-reject rate exceeds ~20%, validator heuristics are loosened or move to a classifier model

### Risk: Case A/C users see the disabled CTA in v0.1 and lose confidence

**Impact:** Users assigned Case A or Case C see "Phase 2 coming soon" indefinitely while Case B users get a working flow. May read as broken or stalled.

**Mitigation:**
- Phase 1 disabled-CTA copy refreshed to reference upcoming Case A / Case C work explicitly
- v0.2 scope explicitly includes Case A and Case C paths (not deferred indefinitely)
- Frontend feature flag controls who sees Phase 2 entry; Case A/C users see the existing Phase 1 surface unchanged (no broken-link experience)

---

## 10. Dependencies

### Blocks

- Positioning v2 — Phase 2 v0.2 (Case A + Case C paths): builds on v0.1 infrastructure
- Positioning v2 — Phase 3 onward: per Phase 1 FRD, future phases consume positioning_run_v2 state which Phase 2 now writes to via current_phase advancement
- Cover Letter handoff (v0.2+): future work; not specified in this FRD beyond the sketch in §6.11

### Blocked by

- **Positioning v2 — Phase 1** — Phase 2 consumes positioning_run_v2.case_assigned, .case_specific, .phase_data structure. Must be shipped and stable.
- **Positioning Foundation** — same dependencies as Phase 1 (candidate_targeting, signal_applications.positioning_run_id, findOrCreateSignalApplication, resolveCareerStage utilities, lane taxonomy)
- **JobFit V5 output** — risk_structured and why_structured drive item population (§6.2). V4 fallback (no severity tagging) means Phase 2 may surface lower-quality items for users with old runs. Same caveat as Phase 1.
- **client_personas table** — persona save at completion writes to this table. Schema is stable per existing code.

### External dependencies

- **Claude Haiku API** — three AI integration paths (§6.7) require Claude Haiku availability + API key configured in production. Existing Haiku usage (jobfit V5 renderer) confirms the integration path; Phase 2 adds new prompt templates but no new infrastructure.
- **Frontend routing** — Phase 2 page at `/positioning/v2/[positioning_run_id]/phase2` or similar. Coordinate with existing positioning routes from Phase 1 frontend.

---

## 11. Operational constraints

### Dev-only by default

All changes ship to dev environment first. Production promotion is a separate explicit step requiring Peri approval. The phase2_runs table migration applies to dev via Supabase SQL Editor workaround (per Foundation Risk 6) before any production work.

### Feature flag rollout strategy

Recommended: feature flag controls which users see Phase 2 entry. Initial rollout:
1. Internal testing (Peri) on dev
2. One live client test (TBD)
3. Small percentage of dev users (Case B only)
4. Full Case B rollout on dev
5. Case B production rollout in stages
6. Case A and Case C expansion (v0.2 scope, separate FRD addendum)

Feature flag implementation is out of v2 Phase 2 scope (depends on existing flag infrastructure or new tool); document the recommendation.

### AI cost monitoring

Per-call cost logging (§6.7 common contract) feeds a cost dashboard (post-launch, out of v0.1 scope). Manual review of phase2_runs.ai_cost_cents distribution after 10+ completed runs sets the long-term cap value (§12.7). Early operational pattern: spot-check weekly.

### Grounding validator telemetry

Every grounding rejection logs `(item_id, draft_type, raw_draft, rejection_reason, allowed_sources_summary)` for post-launch tuning. The validator is intentionally conservative (§6.8) — initial false-reject rate is unknown and likely non-trivial.

Operational pattern:
- Per-rejection log written to a dedicated grounding-rejections table or structured log stream (implementation detail; coordinate with existing logging conventions)
- Review the first 100 rejections manually to recalibrate validator thresholds:
  - Were rejections genuine ungrounded outputs (validator working as intended)?
  - Or were they false rejects (overly strict validator rejecting reasonable drafts)?
- If false-reject rate exceeds ~20%, tighten validator heuristics or move to a small classifier model per §6.8
- If genuine-ungrounded rate is non-trivial, audit prompt design — the "no invention" constraint may need to be more explicit or move into the model's system prompt rather than user prompt

Grounding rejections are also a leading indicator of the manual-entry-mode flow (§6.9.1) being exercised. Track the rejection rate AND the downstream manual-entry completion rate together: if users hit manual-entry mode frequently AND complete their manual drafts, the validator is doing its job. If users hit manual-entry mode and abandon, the validator may be too strict.

### Rollback plan

- phase2_runs table can be dropped (no other tables FK to it from non-Phase-2 code)
- POST /api/positioning/v2/phase2/* endpoints can be removed without affecting Phase 1, JobFit, Cover Letter
- Phase 1 frontend CTA reverts to "Phase 2 coming soon" disabled state
- Cover Letter tab continues using persona.resume_text (unchanged in v0.1, so no rollback needed)
- Personas created via Phase 2 persist; they're indistinguishable from manually-created personas at the schema level

Phase 2 is safe to roll back because the entry point (Phase 1 CTA) was a placeholder before this FRD and can return to that state with no orphan data exposed to users.

### Persona save side-effect note

When a user opts to save their revised resume as a new persona, that persona becomes part of their persona library and is selectable for future JobFit runs. Rollback does not delete those saved personas (data preservation principle). If Phase 2 is rolled back, the personas remain but new ones stop being created.

---

## 12. Open questions

1. **Recommendation surfacing threshold.** What specifically counts as "considerable difference"? Needs tuning with real data. Initial guess: surface only risks marked high+ severity, or risks that score-impact analysis shows would shift JD-fit by 5+ points.

2. **State save frequency.** Every interaction or batched? Lean toward every interaction for simplicity; can optimize if it produces too many DB writes.

3. **Persona naming default.** "Catherine — Product Marketing" or "Catherine — Diligent Product Marketing Intern" or other? Affects how persona library grows over time. v0.1 default per §5.5: derived from JD/role context. Specific template TBD.

4. **Item ordering on selection screen.** By impact (highest score-impact first)? By section (headline, bullets, gaps)? By case (A/B/C-specific defaults)? Needs UX decision. v0.1 default per §6.2: headline first, then bullets/gaps by impact descending.

5. **Gap-item insertion anchor.** When the user accepts a gap-type item that produces a new bullet, where does it go in the revised resume? v0.1 default per §6.10: Skills section for skill-type gaps, most-recent experience entry for bullet-type gaps. Needs validation with real data.

6. **Cover Letter handoff specifics.** Deferred to v0.2+ per §6.11. The consumption contract sketch is in §6.11; specific lookup query TBD when v0.2 is scoped.

7. **AI cost ceiling per phase2_run.** Generation is multi-call. Initial proposal: $0.50/run. Validate with first 10 completed runs before finalizing.

8. **Behavior when user runs Phase 2 twice on the same positioning_run.** Per §6.4: re-entering after completed/abandoned creates a new phase2_run with fresh state. Confirm this matches user expectation vs. resume-previous-state alternative.

9. **System-timeout abandonment threshold.** §6.4 references "30-day inactivity" matching positioning_runs_v2 lifecycle. Confirm this is the right window — Phase 2 might warrant a shorter timeout because per-run scope is narrower.

10. **Frontend route convention.** `/positioning/v2/[id]/phase2` or `/positioning/v2/phase2/[positioning_run_id]` or different? Coordinate with Phase 1 routing already established.

11. **Edit-decision revisability.** Per §6.5.4: re-deciding an already-decided item returns 409 in v0.1. Should v0.1 allow revising decisions, or is "redo from scratch" (new phase2_run) the right primitive? Lean toward 409 in v0.1 for simplicity; revisit if user feedback demands.

---

## 13. v0.1 ship plan

Target: Case B path only, end-to-end functional.

Build order (suggested — maps to §7 implementation phases):
1. phase2_runs table + migrations (Phase 2a)
2. POST /api/positioning/v2/phase2/start — selection screen population from existing positioning_run data (Phase 2b)
3. GET /api/positioning/v2/phase2/[id] (Phase 2b)
4. POST .../draft — the three AI-integration paths with grounding validation (Phase 2b)
5. POST .../decide — accept/decline/edit/skip + state save + revised_resume_text update (Phase 2b)
6. POST .../complete + persona save flow (Phase 2b)
7. Framer: selection screen (Phase 2c)
8. Framer: section workflow per pattern (Pattern A headline; Pattern B bullet; Pattern C gap) (Phase 2d)
9. Framer: side-by-side comparison view (Phase 2c)
10. Framer: completion + persona save UX (Phase 2e)
11. End-to-end testing with test100 + Case B JD (Phase 2f)
12. Live test with one real client — TBD (Phase 2f)

First real client: TBD — Lily Stein or Dimitri Dimitrakis are candidates; both in active interview prep.

---

## 14. Acceptance criteria

Phase 2 v0.1 is complete when:

- ✅ `phase2_runs` table exists in dev DB with all columns + indexes + trigger
- ✅ All five `/api/positioning/v2/phase2/*` endpoints exist and pass integration tests
- ✅ Item population from positioning_run_v2 + jobfit_run produces correct items per §6.2 filter rules
- ✅ All three AI integration paths (headline, bullet reframe, gap discussion) generate grounded drafts
- ✅ Grounding validation rejects synthetic ungrounded drafts and accepts grounded ones
- ✅ Manual-entry mode (§6.9.1) engages on 422 and accepts user-typed content with manual_entry flag recorded
- ✅ AI cost cap enforces 429 response when exceeded
- ✅ Selection screen renders all item types with correct status indicators
- ✅ Each interaction pattern works end-to-end (Pattern A headline; Pattern B bullet; Pattern C gap)
- ✅ Side-by-side comparison updates live on accept
- ✅ Pause + resume preserves all state including in-progress draft text
- ✅ Persona save flow creates a new client_personas row with revised resume_text and user-specified name
- ✅ "I'm done" early-completion CTA works at any point
- ✅ End-to-end test with test100 + Case B JD scenarios passes
- ✅ One live client tested end-to-end: produced a revised resume they would actually use, saved it as a persona, completed within the 15-minute target, with zero observed grounding violations
- ✅ No regressions in Phase 1, JobFit, v1 Positioning, or Cover Letter base behavior
- ✅ Internal testing completed in dev

Production promotion requires separate Peri approval.

---

## 15. References

- **Design reference document:** `C:\Users\perig\wrnsignal-api\docs\positioning-design-reference-v2.md`
- **Phase 1 FRD:** `C:\Users\perig\wrnsignal-api\docs\Features\positioning-phase1-frd.md`
- **Foundation FRD:** `C:\Users\perig\wrnsignal-api\docs\Features\positioning-foundation-frd.md`
- **Foundation runlog:** `C:\Users\perig\wrnsignal-api\docs\Features\foundation-migration-runlog.md` (case_determination tuning context; dev DB migration friction reference)
- **case_determination implementation:** `lib/positioning/v2/caseDetermination.ts` (source of case_assigned values that Phase 2 reads)
- **case_specific implementation:** `lib/positioning/v2/caseSpecific.ts` (source of headline recommendation + refinement items Phase 2 promotes to phase2_run items)
- **JobFit V5 output:** `app/api/jobfit/bulletGeneratorV5.ts:33-77` (risk_structured + why_structured shape Phase 2 consumes)
- **Existing Claude Haiku integration pattern:** `app/api/jobfit/bulletGeneratorV5.ts` (architecture reference for Phase 2 AI client)
- **positioning_runs_v2 table:** created in Phase 1; see Phase 1 FRD section 4.3
- **client_personas table:** `prod_public_schema.sql:152-162`
- **signal_applications.positioning_run_id FK:** created in Foundation; see Foundation FRD
