# FRD: Positioning v2 — Phase 1 (Setup and Scope Calibration)

**Feature ID:** [Assigned by PM]
**Category:** JobFit Engine
**Release:** Positioning v2
**Status:** Draft — awaiting Peri approval
**Author:** Peri Ginsberg + Claude (design conversation)
**Date:** [draft date]

**Design reference:** `C:\Users\perig\wrnsignal-api\docs\positioning-design-reference-v2.md`
**Depends on:** Positioning Foundation FRD

---

## 1. Context and motivation

Phase 1 is the entry point into the rebuilt Positioning workflow. The user arrives from JobFit (or returning to a previously started session) and needs to be oriented before substantive work begins.

Phase 1's job:
1. Orient the user — which job, what JobFit said, what we're about to do
2. Determine the scope of work for this application (Case A, B, or C)
3. Set expectations appropriately for the workflow ahead

Phase 1 establishes patterns that subsequent phases inherit:
- The API contract shape for `/api/positioning/v2/*` endpoints
- The positioning_runs_v2 data model and phase_data persistence pattern
- The case-calibrated rendering principle (Scaled Customization)
- Session lifecycle (in_progress → completed | abandoned)

Phase 1 is where the user first encounters the Positioning rebuild. Getting the entry experience right matters disproportionately — a confusing or punishing entry creates abandonment before substantive value can be delivered.

---

## 2. Goals and non-goals

### Goals

1. Implement case determination logic (Case A/B/C) using cascading rules over JobFit findings
2. Establish the `/api/positioning/v2/start` endpoint as the entry point to the rebuilt workflow
3. Create the `positioning_runs_v2` table with phase-aware data model
4. Implement case-calibrated UI/copy for each of three cases
5. Support save-and-return for users who don't complete Phase 1 immediately
6. Support "Reconsider the target" reflection prompt for Case C users
7. Link positioning_run_v2 to signal_applications via Foundation's new FK column

### Non-goals

- Implementing Phases 2, 3, 5 (separate FRDs per phase)
- Implementing Phase 4 audit detection (v2.5 work)
- Modifying or deprecating v1 Positioning (`/api/positioning`) — coexists during transition
- Building admin tools for case threshold tuning (deferred; thresholds live in code config)
- Multi-job comparison views (deferred; signal_applications supports it data-wise but UI is future work)
- Reporting or analytics on case distribution (out of scope; data is captured, analysis is future)

---

## 3. Scope

This FRD covers:

1. **Case determination logic** (server-side decision engine)
2. **`/api/positioning/v2/start` endpoint** (new API)
3. **`positioning_runs_v2` table** (new schema, isolated from v1)
4. **Phase 1 frontend rendering** (three case variants)
5. **"Reconsider the target" reflection prompt**
6. **Save-and-return behavior** (returning user detection and adjusted welcome)
7. **signal_applications linkage** (consumes Foundation's findOrCreateSignalApplication utility)

All deliverables ship to dev environment first. Production promotion is a separate explicit step.

---

## 4. Technical design

### 4.1 Case determination logic

#### Inputs

When `/api/positioning/v2/start` is called, the system gathers:

**From JobFit's most recent run for this (profile, job):**
- `verdict` (Priority Apply | Apply | Review | Pass)
- `score` (numeric)
- `why_structured[]` (positive findings)
- `risk_structured[]` (gaps/risks with severity)
- `risk_codes[]` (categorical risks)
- `cover_letter_strategy` (V5 only; null on Pass)
- `score_breakdown`

**From candidate_targeting (via Foundation):**
- Primary lane + sub-lane
- Career stage
- Status indicators

**From the resume (via existing parsers):**
- Current resume content (for context, not direct evaluation in Phase 1)

#### Determination algorithm

```typescript
function determineCase(inputs: CaseInputs): { case: 'A' | 'B' | 'C'; reasoning: string } {
  // Rule 1: Pass verdict forces Case C
  if (inputs.jobfit.verdict === 'Pass') {
    return {
      case: 'C',
      reasoning: 'JobFit verdict is Pass; significant repositioning required to compete.',
    };
  }
  
  // Rule 2: Review verdict
  if (inputs.jobfit.verdict === 'Review') {
    const hasHighSeverityRisk = inputs.jobfit.risk_structured.some(r => r.severity === 'high');
    if (hasHighSeverityRisk) {
      const topRisk = inputs.jobfit.risk_structured.find(r => r.severity === 'high');
      return {
        case: 'C',
        reasoning: `JobFit verdict is Review with high-severity risk: ${topRisk?.keyword || 'unknown'}.`,
      };
    }
    return {
      case: 'B',
      reasoning: 'JobFit verdict is Review with manageable risks; targeted changes needed.',
    };
  }
  
  // Rule 3: Apply or Priority Apply verdict
  if (inputs.jobfit.verdict === 'Apply' || inputs.jobfit.verdict === 'Priority Apply') {
    const riskCount = inputs.jobfit.risk_structured.length;
    const whyCount = inputs.jobfit.why_structured.length;
    const hasHighSeverityRisk = inputs.jobfit.risk_structured.some(r => r.severity === 'high');
    
    // Case A: clear well-positioned scenarios only
    if (riskCount === 0 && whyCount >= CASE_A_MIN_WHY_COUNT) {
      return {
        case: 'A',
        reasoning: `JobFit verdict is ${inputs.jobfit.verdict} with no surfaced risks and ${whyCount} positive findings.`,
      };
    }
    
    // High-severity risk forces Case B even with favorable verdict
    if (hasHighSeverityRisk) {
      const topRisk = inputs.jobfit.risk_structured.find(r => r.severity === 'high');
      return {
        case: 'B',
        reasoning: `Favorable JobFit verdict but high-severity risk present: ${topRisk?.keyword || 'unknown'}.`,
      };
    }
    
    // Default: Case B for any Apply/Priority Apply with non-zero risks
    return {
      case: 'B',
      reasoning: `JobFit verdict is ${inputs.jobfit.verdict} with ${riskCount} risk(s); targeted changes needed.`,
    };
  }
  
  // Fallback (shouldn't reach here)
  return {
    case: 'B',
    reasoning: 'Default case assignment (unexpected verdict value).',
  };
}
```

#### Thresholds in config

```typescript
// /lib/positioning/caseThresholds.ts

export const CASE_A_MIN_WHY_COUNT = 3;  // minimum positive findings for Case A eligibility
export const CASE_C_HIGH_SEVERITY_TRIGGER = true;  // any high-severity risk in Review forces C
```

Thresholds in code config rather than DB so changes are version-controlled. Future tuning is a code change.

#### Edge cases handled

- **No JobFit run exists for this (profile, job):** Should not happen via normal user flow (JobFit is the entry to Positioning). API returns 404 with explanatory error if it does. Defensive coding only.
- **JobFit run exists but uses v4 schema (no risk_structured):** Falls back to risk_codes for severity inference. v4 risk_codes don't have explicit severity, so default to medium and apply Case B unless verdict is Pass.
- **Empty risk_structured AND empty why_structured (rare):** Treats as Case B (default). The JobFit run had no findings to surface, suggesting unusual data.

### 4.2 `/api/positioning/v2/start` endpoint

#### Authentication

Uses existing pattern: Bearer token → `getAuthedProfileText()` to resolve profile_id.

#### Request

```typescript
POST /api/positioning/v2/start
Authorization: Bearer <token>
Content-Type: application/json

{
  job: {
    title: string;              // required
    company: string;            // required
    description: string;        // required, full JD text
    url?: string;               // optional
    location?: string;          // optional
  };
  persona_id?: string;          // optional; defaults to user's current default persona
  jobfit_run_id?: string;       // optional; if absent, system looks up latest jobfit_run for (profile, job)
}
```

#### Request validation

- All fields in `job` validated for non-empty strings (except optional `url`, `location`)
- `persona_id` if provided must exist and belong to authenticated profile
- `jobfit_run_id` if provided must exist; if absent, system queries jobfit_runs for most recent run matching (profile_id, company, job_title)
- If no matching jobfit_run found, return 404 with `error: 'no_jobfit_run'`

#### Response shape

```typescript
{
  positioning_run_id: string;
  signal_application_id: string;
  
  case: 'A' | 'B' | 'C';
  case_reasoning: string;
  
  context: {
    job: {
      title: string;
      company: string;
      location: string | null;
      days_since_jobfit: number;
    };
    persona: {
      id: string;
      name: string;
    };
    career_stage: 'student' | 'early_career' | 'mid_career' | 'executive';
    candidate_targeting: {
      primary_lane: string;
      primary_sublane: string | null;
    };
  };
  
  jobfit_summary: {
    verdict: 'Priority Apply' | 'Apply' | 'Review' | 'Pass';
    score: number;
    why_count: number;
    risk_count: number;
    risk_severity_breakdown: {
      high: number;
      medium: number;
      low: number;
    };
  };
  
  workflow_preview: {
    gap_count: number;
    gap_themes: string[];                  // 1-3 brief gap theme strings
    content_review_required: boolean;
    audit_findings_count: number | null;   // null in v2 (Phase 4 stubbed)
    estimated_minutes: number;             // 0 for A, 15-20 for B, 30-45 for C
  };
  
  case_specific: {
    // Case A only
    well_positioned_summary?: string;
    small_refinements?: Array<{
      id: string;
      description: string;
    }>;
    
    // Case C only
    inferred_lane_mismatch?: {
      resume_reads_as: string | null;   // null in v2 (blind-read not yet implemented)
      job_asking_for: string;
    };
    high_severity_gap_summary?: string;
  };
  
  returning_user: {
    is_returning: boolean;
    last_visit_days_ago: number | null;
  };
}
```

#### Endpoint behavior

```typescript
async function handlePositioningV2Start(req: Request): Promise<Response> {
  // 1. Auth
  const profileId = await authenticateProfile(req);
  
  // 2. Parse and validate request
  const { job, persona_id, jobfit_run_id } = parseAndValidate(req);
  
  // 3. Resolve persona (default if not provided)
  const persona = await resolvePersona(profileId, persona_id);
  
  // 4. Resolve jobfit_run (lookup if not provided)
  const jobfitRun = jobfit_run_id 
    ? await getJobfitRun(jobfit_run_id)
    : await findLatestJobfitRun(profileId, job.company, job.title);
  
  if (!jobfitRun) {
    return errorResponse(404, 'no_jobfit_run', 'No JobFit run found for this job.');
  }
  
  // 5. Resolve candidate_targeting (from Foundation)
  const targeting = await getCandidateTargeting(profileId);
  
  // 6. Resolve career_stage (Foundation utility)
  const careerStage = await resolveCareerStage(profileId);
  
  // 7. Check for existing positioning_run_v2
  const fingerprint = computeFingerprint({
    profileId,
    personaId: persona.id,
    jobDescription: job.description,
    targetingState: targeting,
  });
  
  const existing = await findExistingPositioningRunV2(profileId, persona.id, jobfitRun.id, fingerprint);
  
  if (existing && existing.status === 'in_progress') {
    // Resume session
    return await buildResponseFromRun(existing, { isReturning: true });
  }
  
  if (existing && existing.status === 'completed' && fingerprint.matches(existing.fingerprint_hash)) {
    // Cache hit
    return await buildResponseFromRun(existing, { isReturning: false, cached: true });
  }
  
  // 8. Run case determination
  const caseResult = determineCase({
    jobfit: jobfitRun.result_json,
    targeting,
    careerStage,
  });
  
  // 9. Generate workflow preview
  const workflowPreview = generateWorkflowPreview(caseResult.case, jobfitRun);
  
  // 10. Generate case-specific data
  const caseSpecific = generateCaseSpecific(caseResult.case, jobfitRun, targeting);
  
  // 11. Create positioning_run_v2
  const run = await createPositioningRunV2({
    profileId,
    personaId: persona.id,
    jobfitRunId: jobfitRun.id,
    job,
    caseAssigned: caseResult.case,
    caseReasoning: caseResult.reasoning,
    fingerprint,
    currentPhase: 1,
    phaseData: { phase_1: { case_assigned_at: new Date() } },
  });
  
  // 12. Link to signal_applications (Foundation utility)
  const signalApp = await findOrCreateSignalApplication({
    profileId,
    companyName: job.company,
    jobTitle: job.title,
    jobUrl: job.url,
    jobDescription: job.description,
    personaId: persona.id,
    jobfitRunId: jobfitRun.id,
    positioningRunId: run.id,
  });
  
  // 13. Return response
  return successResponse(buildResponse({
    run,
    signalApp,
    caseResult,
    workflowPreview,
    caseSpecific,
    context: { job, persona, careerStage, targeting, jobfitRun },
    isReturning: false,
  }));
}
```

### 4.3 `positioning_runs_v2` table

#### Schema

```sql
CREATE TABLE positioning_runs_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  persona_id UUID NOT NULL REFERENCES client_personas(id),
  jobfit_run_id UUID REFERENCES jobfit_runs(id),
  signal_application_id UUID REFERENCES signal_applications(id),
  
  -- Job context
  job_title TEXT NOT NULL,
  job_company TEXT NOT NULL,
  job_url TEXT,
  job_description TEXT NOT NULL,
  
  -- Case determination
  case_assigned TEXT NOT NULL CHECK (case_assigned IN ('A', 'B', 'C')),
  case_reasoning TEXT NOT NULL,
  
  -- Session state
  current_phase INTEGER NOT NULL DEFAULT 1 CHECK (current_phase BETWEEN 1 AND 5),
  phase_data JSONB NOT NULL DEFAULT '{}',
  
  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (
    status IN ('in_progress', 'completed', 'abandoned')
  ),
  
  -- Fingerprint for caching
  fingerprint_hash TEXT NOT NULL,
  fingerprint_code TEXT NOT NULL,
  
  -- Result snapshot when completed
  result_json JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_positioning_runs_v2_profile_id ON positioning_runs_v2(profile_id);
CREATE INDEX idx_positioning_runs_v2_jobfit_run_id ON positioning_runs_v2(jobfit_run_id);
CREATE INDEX idx_positioning_runs_v2_status ON positioning_runs_v2(status);
CREATE INDEX idx_positioning_runs_v2_fingerprint ON positioning_runs_v2(fingerprint_hash);
CREATE INDEX idx_positioning_runs_v2_signal_application ON positioning_runs_v2(signal_application_id);

CREATE TRIGGER update_positioning_runs_v2_updated_at
  BEFORE UPDATE ON positioning_runs_v2
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

#### `phase_data` JSONB structure for Phase 1

```typescript
{
  phase_1: {
    case_assigned_at: ISO8601,
    visits: [
      { visited_at: ISO8601, action: 'viewed' | 'saved_for_later' | 'started' }
    ],
    reconsider_target_clicked?: boolean;
    reconsider_target_outcome?: 'proceeded' | 'will_think_about_it' | 'viewed_other_runs';
  }
}
```

Subsequent phases append their own keys (phase_2, phase_3, etc.) without affecting Phase 1's data.

#### Status lifecycle

- **in_progress** (default on creation) — user is working through the workflow
- **completed** — user finished Phase 5 (change list generated, application ready)
- **abandoned** — explicit user action (closed without completing) OR system timeout (e.g., no activity for 30 days)

Phase 1 alone does not transition status to completed. Completion requires Phase 5.

### 4.4 Frontend rendering

#### Component structure

```
PositioningPhase1Page
├── PositioningHeader
│   ├── JobTitleAndCompany
│   ├── JDAgeDisplay  
│   └── PersonaDisplay
├── JobfitVerdictCard (always visible, subtle)
├── CaseFramingBlock (case-specific)
│   ├── CaseAFraming
│   ├── CaseBFraming
│   └── CaseCFraming
├── WorkflowPreviewBlock (case-specific)
├── TimeExpectationBlock (case-specific)
└── CTABlock (case-specific buttons)
```

#### Case A rendering

```
Header
├── Persona: [persona.name]
├── JD analyzed [N] days ago

JobfitVerdictCard
├── "JobFit said: [Priority Apply / Apply]"
├── Score: [N]

CaseAFraming
├── Headline: "Your resume is well-positioned for this role."
├── Body: "[well_positioned_summary]"

WorkflowPreviewBlock (only if small_refinements.length > 0)
├── "1-2 small refinements we noticed:"
├── List: [small_refinements]

CTABlock
├── if (small_refinements.length > 0):
│   └── [Button: "Review small refinements"] → goes to Phase 5 with just refinements
│   └── [Button: "I'm ready to apply"] → marks signal_application status
├── else:
│   └── [Button: "I'm ready to apply"] (prominent)
```

#### Case B rendering

```
Header (same)

JobfitVerdictCard
├── "JobFit said: [Apply / Priority Apply / Review]"
├── Score: [N]

CaseBFraming
├── Headline: "Your resume needs targeted changes to compete strongly for this role."
├── Body: "A resume should tell one story at a time. For this application, that means tightening focus and addressing specific gaps."
├── Body continued: "Here's what we'll work through:"

WorkflowPreviewBlock
├── "1. [gap_count] gaps to discuss — [gap_themes joined]"
├── "2. Resume content review — headline, summary, skills, and bullet alignment"
├── "3. [audit_findings_count or 'Formatting check (coming soon)'] — formatting and structure"

TimeExpectationBlock
├── "This will take about [estimated_minutes] minutes."
├── "You can save your progress and return anytime."

CTABlock
├── [Button: "Let's start"] (primary) → advances to Phase 2
├── [Button: "Save for later"] (secondary) → closes Phase 1, persists state
```

#### Case C rendering

```
Header (same)

JobfitVerdictCard
├── "JobFit said: [Pass / Review]"
├── Score: [N]

CaseCFraming
├── Headline: "Your resume is telling a different story than this job is asking for."
├── Body: "Our analysis shows significant gaps between your current positioning and what this role requires."
├── Body continued: "Before we work through them: this is a real question worth asking."
├── SubHeadline: "Is this the right job to pursue?"
├── Body: "[inferred_lane_mismatch comparison if available, otherwise generic mismatch description]"
├── Body: "To compete strongly for this role, the work ahead is substantial:"

WorkflowPreviewBlock
├── "1. [gap_count] gaps to address, including [high_severity_gap_summary]"
├── "2. Headline and summary likely need rewriting for this target"
├── "3. Multiple bullets may need reframing"
├── "4. [audit_findings_count or 'Formatting check (coming soon)']"

TimeExpectationBlock
├── "This will take 30-45 minutes."
├── "Be prepared for substantive changes."

CTABlock
├── [Button: "Yes, let's work on this"] (primary) → advances to Phase 2
├── [Button: "Reconsider the target"] (tertiary) → opens reflection prompt
├── [Button: "Save for later"] (secondary) → closes Phase 1, persists state
```

#### Returning user adjustments (all cases)

When `returning_user.is_returning === true`, prepend a welcome banner before the case-specific framing:

```
ReturningUserBanner
├── "Welcome back to Positioning for [Job Title] @ [Company]."
├── "You last visited [N] days ago. Here's where we left off."
```

The case framing block then follows. No other copy changes.

### 4.5 "Reconsider the target" reflection prompt

#### When triggered

User clicks "Reconsider the target" button on Case C Phase 1 screen.

#### Modal content

```
ReconsiderTargetModal
├── Headline: "Take a moment to think about this opportunity."
├── Body: "Your resume currently reads as targeting [inferred_lane or 'a different direction']. Some questions to consider:"
├── Question list:
│   ├── "Why are you pursuing this specific role?"
│   ├── "Do you have specific contacts at this company?"
│   ├── "Are there other open positions that align better with your current resume?"
├── CTABlock:
│   ├── [Button: "I want to proceed anyway"] → closes modal, returns to Case C Phase 1; sets phase_data.reconsider_target_outcome = 'proceeded'
│   ├── [Button: "Let me think about this"] → closes modal AND closes Phase 1 (acts as Save for later); sets phase_data.reconsider_target_outcome = 'will_think_about_it'
│   ├── [Button: "Show me other JobFit runs"] → closes modal AND navigates to user's JobFit history filtered to Apply/Priority Apply verdicts; sets phase_data.reconsider_target_outcome = 'viewed_other_runs'
```

#### Data captured

```typescript
phase_data.phase_1.reconsider_target_clicked = true;
phase_data.phase_1.reconsider_target_outcome = 'proceeded' | 'will_think_about_it' | 'viewed_other_runs';
phase_data.phase_1.reconsider_target_clicked_at = ISO8601;
```

This data feeds future product learning (are users who reconsider proceeding or backing off?).

### 4.6 Save-and-return behavior

#### Detection

When `/api/positioning/v2/start` is called:

1. Check for existing positioning_run_v2 row matching (profile_id, persona_id, jobfit_run_id)
2. If found with status='in_progress':
   - This is a returning user
   - Update `phase_data.phase_1.visits` array with new visit timestamp
   - Return the existing run with `returning_user.is_returning = true`
3. If found with status='completed' AND fingerprint matches:
   - Return cached result
4. If not found OR fingerprint mismatch:
   - New run, fresh case determination

#### Persistence

Phase 1 itself doesn't require persistence beyond positioning_run_v2 row creation. The signal_application already exists (created by JobFit). Returning to Phase 1 reconstructs everything from:
- positioning_run_v2 (case, persona, jobfit linkage)
- jobfit_run.result_json (verdict, findings)
- candidate_targeting (lane, career stage)

#### "Save for later" button behavior

When user clicks "Save for later":
- positioning_run_v2 row already exists (created on Phase 1 load)
- No additional state to save
- Frontend closes Phase 1 page, navigates user back to their dashboard or wherever they came from
- `phase_data.phase_1.visits` appends entry with action='saved_for_later'

### 4.7 Cache invalidation

A positioning_run_v2's fingerprint includes:
- Profile ID
- Persona ID (resume version)
- JD content hash
- candidate_targeting state hash (lane + sub-lane + career_stage)

If any of these change between sessions, the cached run is stale. New run created on next visit.

Specifically:
- User uploads new resume (new persona becomes default) → new fingerprint → new run
- User updates lane via candidate_targeting → new fingerprint → new run
- User opens Positioning for the same job after JD edit (unusual) → new fingerprint → new run
- Same user, same persona, same job, same targeting → fingerprint match → cached run resumed

---

## 5. Implementation phases

### Phase 1a: Schema and infrastructure

1. Create `positioning_runs_v2` table in dev DB (note: dev DB migration friction per Foundation Risk 6 may require SQL Editor workaround)
2. Create `/lib/positioning/v2/caseThresholds.ts` config
3. Create `/lib/positioning/v2/caseDetermination.ts` utility
4. Create `/lib/positioning/v2/workflowPreview.ts` utility
5. Create `/lib/positioning/v2/caseSpecific.ts` data generator

### Phase 1b: API endpoint

1. Create `/api/positioning/v2/start/route.ts`
2. Implement request validation
3. Implement endpoint logic per section 4.2
4. Integration with Foundation's `findOrCreateSignalApplication` utility
5. Integration with Foundation's `resolveCareerStage` utility
6. Caching logic for resume/new-run/cache-hit scenarios

### Phase 1c: Frontend rendering

1. Create Phase 1 page route (likely `/positioning/v2/[positioning_run_id]` or similar — coordinate with frontend conventions)
2. Implement component structure per section 4.4
3. Per-case rendering variants (A, B, C)
4. Returning user banner
5. "Reconsider the target" modal
6. CTA wiring (Let's start → Phase 2 route; Save for later → close; I'm ready to apply → signal_application status update)

### Phase 1d: Reconsider target flow

1. Implement modal component
2. Implement "Show me other JobFit runs" navigation (may require filtered JobFit history page if not exists)
3. Data capture per section 4.5

### Phase 1e: Testing and integration

1. End-to-end testing in dev
2. Each case path verified (A with refinements, A without, B, C, C with reconsider)
3. Returning user scenarios verified
4. Cache hit and cache miss scenarios verified
5. signal_applications linkage verified

---

## 6. Testing strategy

### Unit tests

- `determineCase` with all verdict + risk combinations
- Workflow preview generation for each case
- Case-specific data generation
- Fingerprint computation and matching
- Returning user detection logic

### Integration tests

- `/api/positioning/v2/start` end-to-end:
  - New user, no positioning history → fresh run created
  - Returning user with in_progress run → run resumed
  - Same user, same job, no changes → cache hit
  - Same user, same job, resume changed → new run created
  - Same user, same job, lane changed → new run created
  - JobFit run missing → 404 with error code
- signal_applications linkage verification
- candidate_targeting consumption verification

### Case determination accuracy tests

- Construct synthetic jobfit_runs with known verdict + risk patterns
- Verify case assignment matches expected case for each pattern
- Verify case_reasoning explains the assignment correctly

### Frontend tests

- Each case renders correct copy
- Buttons trigger correct navigation/state changes
- Returning user banner shows when appropriate
- Reconsider target modal opens and routes correctly

### Regression tests

- v1 Positioning (`/api/positioning`) still works
- Cover Letter generation still works
- JobFit run creation still works
- No regressions in signal_applications.application_status field

---

## 7. Risks and mitigations

### Risk: Case determination accuracy

**Impact:** Users assigned the wrong case get a calibrated experience that doesn't match their actual needs. A Case A user routed to Case B sees unnecessary workflow; a Case C user routed to Case B doesn't get the "reconsider target" framing.

**Mitigation:**
- Thresholds in code config (easy to tune)
- `case_reasoning` captured for every run (enables post-launch analysis)
- Manual sampling of case assignments during dev testing
- Plan to revisit thresholds after 1-2 weeks of production data

### Risk: Coexistence with v1 Positioning

**Impact:** Two endpoints exist; users could be confused if frontend routes inconsistently. Bugs in v2 could affect users who are routed to it.

**Mitigation:**
- v1 (`/api/positioning`) untouched by this FRD
- v2 endpoint at `/api/positioning/v2/start` (clear namespacing)
- Frontend feature flag controls which endpoint is invoked for which users (gradual rollout in dev)
- Deprecation of v1 happens after Cover Letter Integration ships and v2 is proven

### Risk: Save-and-return data integrity

**Impact:** User saves for later, JD changes (edits to job description in some external source), user returns and finds case has shifted. Confusing.

**Mitigation:**
- Fingerprint detects JD content change → new run created
- Returning user banner mentions previous case if it changed: "We've re-evaluated your scope since your last visit because [resume changed | targeting changed | JD content changed]."

### Risk: "Reconsider the target" creates abandonment

**Impact:** Case C users with legitimate-but-hard targets back off when they shouldn't.

**Mitigation:**
- Framing is question-based ("Is this the right job?") not directive ("This is the wrong job")
- "I want to proceed anyway" is the first button — defaults toward proceeding
- Data capture lets us measure: of users who clicked "Reconsider," what percentage proceeded vs. backed off vs. left?
- If abandonment is high, soften the framing in a follow-up release

### Risk: positioning_runs_v2 grows large

**Impact:** Every Positioning entry creates a row. Heavy users could generate hundreds of runs.

**Mitigation:**
- Status='abandoned' transition after 30 days of inactivity (cleanup pattern)
- Standard indexing on common query paths
- Future: archival pattern for old completed runs (out of v2 scope)

---

## 8. Dependencies

### Blocks

- Positioning v2 — Phase 2 (Gap Analysis): consumes positioning_run_id created by Phase 1
- Positioning v2 — Phase 3 (Resume Content Review): same dependency
- Positioning v2 — Phase 5 (Change List Output): same dependency
- Positioning v2 — Cover Letter Integration: indirectly depends on Phase 1 (signal_application linkage)

### Blocked by

- **Positioning Foundation** — must ship first. Phase 1 depends on:
  - candidate_targeting table (for context.candidate_targeting and career_stage resolution)
  - signal_applications.positioning_run_id FK
  - findOrCreateSignalApplication utility
  - resolveCareerStage utility
  - Lane taxonomy config

### External dependencies

- **JobFit V5 output** — Phase 1 reads `risk_structured`, `why_structured`, `score_breakdown`. V5 produces these; V4 doesn't. Profiles with old JobFit runs (pre-V5) get degraded case determination (fallback to risk_codes for severity inference, per section 4.1 edge case).
- **Frontend routing infrastructure** — needs ability to route `/positioning/v2/[id]` (or similar) to Phase 1 component. Coordinate with frontend conventions.

---

## 9. Operational constraints

### Dev-only by default

All changes ship to dev environment first. Production promotion is a separate explicit step requiring Peri approval.

### Frontend rollout strategy

Recommended: feature flag controls which users see v2 vs. v1 Positioning. Initial rollout:
1. Internal testing (Peri, Erin, Aiden) on dev
2. Small percentage of dev users
3. Full dev rollout
4. Production rollout in stages

Frontend feature flag implementation is out of v2 Phase 1 scope (depends on existing flag infrastructure or new tool); document the recommendation.

### Rollback plan

- positioning_runs_v2 table can be dropped (no other tables FK to it from non-v2 code)
- signal_applications.positioning_run_id can be cleared (NULL) without affecting v1 Positioning or Cover Letter
- API endpoint can be removed without affecting v1
- Frontend routing reverts to v1 paths

Phase 1 is uniquely safe to roll back because v2 coexists with v1 throughout.

---

## 10. Open questions

1. **Frontend routing convention.** What's the existing convention for Positioning page routes? `/positioning/[id]` or different? Phase 1 follows whatever pattern exists; flag for confirmation during implementation.

2. **Feature flag infrastructure.** Does SIGNAL have an existing feature flag tool, or does this FRD need to specify one? If absent, recommend deferring rollout strategy to a follow-up.

3. **"Show me other JobFit runs" target.** The Reconsider modal's third button needs to navigate somewhere. Is there an existing "my JobFit history" page that supports filtering by verdict? If not, this either gets built as part of this FRD (small addition) or the button is deferred / disabled.

4. **Case threshold tuning post-launch.** When and how do we tune `CASE_A_MIN_WHY_COUNT` and other thresholds after production data? Suggest: weekly review of case_reasoning distribution for first month, then quarterly.

5. **Returning user banner timing.** "You last visited [N] days ago" — what unit should this be? Days for most cases; hours if within 24h ("3 hours ago" vs. "0 days ago"). Implementation detail; flag for refinement.

---

## 11. Acceptance criteria

Phase 1 is complete when:

- ✅ `positioning_runs_v2` table exists in dev DB
- ✅ `/api/positioning/v2/start` endpoint exists and passes integration tests
- ✅ Case determination logic returns correct case for synthetic test scenarios
- ✅ Phase 1 frontend renders correctly for Cases A, B, C
- ✅ Returning user banner displays correctly when applicable
- ✅ "Reconsider the target" modal opens, captures outcome, routes correctly
- ✅ "Save for later" persists state and returning user resumes correctly
- ✅ signal_applications.positioning_run_id is populated correctly
- ✅ Cache hit / new run / resume run scenarios all behave correctly
- ✅ All tests pass (unit, integration, case determination, frontend)
- ✅ No regressions in v1 Positioning, JobFit, Cover Letter flows
- ✅ Internal testing (Peri, Erin) completed in dev

Production promotion requires separate Peri approval.

---

## 12. References

- **Design reference document:** `C:\Users\perig\wrnsignal-api\docs\positioning-design-reference-v2.md`
- **Foundation FRD:** `C:\Users\perig\wrnsignal-api\docs\Features\positioning-foundation-frd.md`
- **JobFit V5 output:** `app/api/jobfit/bulletGeneratorV5.ts:33-77`
- **JobFit evaluator core:** `app/api/_lib/jobfitEvaluator.ts:50-160`
- **signal_applications creation in JobFit:** `app/api/jobfit/route.ts:377-503`
- **Existing v1 Positioning route:** `app/api/positioning/route.ts`
- **client_personas table:** `prod_public_schema.sql:152-162`
- **positioning_runs (v1) table:** `prod_public_schema.sql:462-470`
