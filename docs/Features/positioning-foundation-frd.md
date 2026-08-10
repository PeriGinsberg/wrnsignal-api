> **⚠️ ABANDONED 2026-08-10.** Positioning v2 / Stage 1c was abandoned and its
> code deleted. This document describes a system that does not exist. It is kept
> as history, not as a spec — do not build from it. See
> [docs/positioning-v2-abandoned.md](../positioning-v2-abandoned.md).

# FRD: Positioning Foundation

**Feature ID:** [Assigned by PM]
**Category:** JobFit Engine
**Release:** Positioning v2 (foundation prerequisite)
**Status:** Draft — awaiting Peri approval
**Author:** Peri Ginsberg + Claude (design conversation)
**Date:** [draft date]

**Design reference:** `C:\Users\perig\wrnsignal-api\docs\positioning-design-reference-v2.md`

---

## 1. Context and motivation

SIGNAL's Positioning surface is being rebuilt to become an interactive per-job resume tailoring environment. The rebuild requires foundational infrastructure that doesn't exist today:

- A user-facing lane taxonomy (today: free-text target_roles)
- A unifying data model that links JobFit, Positioning, and Cover Letter runs (today: signal_applications only links JobFit)
- Career-stage data piped to Positioning invocations (today: career stage signals exist but aren't passed to Positioning)
- Intake form updates to capture the new structured targeting data

Without these foundations, none of the downstream Positioning rebuild features (Phases 1, 2, 3, 5, plus Cover Letter integration) can be built. This FRD specifies the foundation as a single coordinated deliverable.

The full product context, design conversation outputs, and five foundational design principles are documented in the design reference linked above. This FRD assumes that context and focuses on implementation specifics.

---

## 2. Goals and non-goals

### Goals

1. Establish lane taxonomy as a user-facing structured vocabulary, mapped to existing JobFamily internal taxonomy
2. Capture targeting data (lane + career stage + status indicators) in a new `candidate_targeting` table that's isolated from `client_profiles` (which is mid-refactor in Wave 3 personas work)
3. Link signal_applications to positioning_runs and coverletter_runs so the application record becomes the genuine unifying entity for application prep
4. Pipe career stage signals (current_status, yearsExperienceApprox, candidate_targeting.career_stage) to Positioning and Cover Letter invocations
5. Update intake form (Framer) to capture lane + sub-lane + status indicators
6. Migrate existing users via bulk inference + user verification (hybrid Option C from design reference)

### Non-goals

- Building any Positioning workflow phases (separate FRDs)
- Building the audit detection in Phase 4 (v2.5 and v3 work)
- Updating Cover Letter to consume new Positioning output (separate FRD — depends on Phase 5)
- Building admin UI for taxonomy management (deferred; code-based config is sufficient for v1)
- Tracking historical changes to candidate_targeting (deferred; current state only)
- PreLaw / PreGrad coaching content (status flags supported; specific coaching logic deferred)

---

## 3. Scope

This FRD covers six coordinated deliverables that must ship together:

1. **Lane taxonomy config** (new code module)
2. **candidate_targeting table** (new schema)
3. **signal_applications schema extension** (FK additions)
4. **Career-stage pipe** (API contract updates)
5. **Intake form updates** (Framer + API)
6. **Migration script** (one-time job for existing users)

All deliverables ship to dev environment first. Production promotion is a separate explicit step.

---

## 4. Technical design

### 4.1 Lane taxonomy

#### Location

Single canonical config file:
```
/lib/laneTaxonomy.ts
```

This file is the source of truth for:
- Intake form options (read by Framer integration)
- Application-layer validation (read by API endpoints)
- JobFamily mapping (read by JobFit and Positioning)
- Blind-read return vocabulary (read by Positioning Phase 3 when implemented)

#### Structure

```typescript
export interface SubLane {
  id: string;              // e.g., 'strategy_consulting'
  label: string;           // e.g., 'Strategy Consulting'
  description?: string;    // optional helper text for intake
}

export interface Lane {
  id: string;              // e.g., 'consulting'
  label: string;           // e.g., 'Consulting'
  description?: string;
  subLanes: SubLane[];
  jobFamilyMapping: JobFamily[]; // maps to existing JobFamily enum
}

export const LANES: Lane[] = [
  {
    id: 'consulting',
    label: 'Consulting',
    jobFamilyMapping: [JobFamily.Consulting],
    subLanes: [
      { id: 'strategy_consulting', label: 'Strategy Consulting' },
      { id: 'management_consulting', label: 'Management Consulting' },
      { id: 'technology_consulting', label: 'Technology Consulting' },
      { id: 'operations_consulting', label: 'Operations Consulting' },
      { id: 'healthcare_consulting', label: 'Healthcare Consulting' },
    ],
  },
  // ... 10 more lanes plus 'other'
];

export const STATUS_INDICATORS = ['premed', 'prelaw', 'pregrad'] as const;
export type StatusIndicator = typeof STATUS_INDICATORS[number];

export const CAREER_STAGES = ['student', 'early_career', 'mid_career', 'executive'] as const;
export type CareerStage = typeof CAREER_STAGES[number];
```

#### The 11 lanes

Complete list (full sub-lane breakdown in design reference document, section "Lane taxonomy locked"):

1. **Consulting** — 5 sub-lanes
2. **Finance** — 5 sub-lanes
3. **Accounting** — 3 sub-lanes
4. **Marketing** — 5 sub-lanes
5. **Sales & Business Development** — 4 sub-lanes
6. **Technology** — 5 sub-lanes
7. **Operations & Strategy** — 4 sub-lanes
8. **Healthcare** — 4 sub-lanes
9. **People & HR** — 5 sub-lanes
10. **Public Sector & Nonprofit** — 4 sub-lanes
11. **Legal** — 4 sub-lanes
12. **Other** — free-text description, no sub-lanes

Total: ~45 sub-lanes plus Other.

#### Validation utilities

```typescript
export function isValidLaneId(id: string): boolean;
export function isValidSubLaneId(laneId: string, subLaneId: string): boolean;
export function getJobFamilyForLane(laneId: string): JobFamily[];
export function getLaneFromJobFamily(family: JobFamily): Lane | null;
```

The reverse mapping (`getLaneFromJobFamily`) supports the migration script — it tries to infer a user's lane from existing JobFit run JobFamily data when their target_roles is ambiguous.

### 4.2 candidate_targeting table

#### Schema

```sql
CREATE TABLE candidate_targeting (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  
  -- Primary targeting (required)
  primary_lane TEXT NOT NULL,
  primary_sublane TEXT,
  primary_other_description TEXT,
  
  -- Secondary targeting (optional, up to 2)
  secondary_lane_1 TEXT,
  secondary_sublane_1 TEXT,
  secondary_lane_2 TEXT,
  secondary_sublane_2 TEXT,
  
  -- Career stage
  career_stage TEXT NOT NULL,
  career_stage_locked_by TEXT NOT NULL CHECK (
    career_stage_locked_by IN ('intake', 'inferred', 'manual_override')
  ),
  
  -- Status indicators
  status_premed BOOLEAN DEFAULT FALSE NOT NULL,
  status_prelaw BOOLEAN DEFAULT FALSE NOT NULL,
  status_pregrad BOOLEAN DEFAULT FALSE NOT NULL,
  
  -- Provenance
  source TEXT NOT NULL CHECK (
    source IN ('intake', 'migration', 'manual_update')
  ),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  
  -- Constraints
  CONSTRAINT one_targeting_per_profile UNIQUE (profile_id),
  CONSTRAINT primary_lane_validation CHECK (
    primary_lane IN (
      'consulting', 'finance', 'accounting', 'marketing',
      'sales_bd', 'technology', 'operations_strategy', 'healthcare',
      'people_hr', 'public_sector', 'legal', 'other'
    )
  ),
  CONSTRAINT career_stage_validation CHECK (
    career_stage IN ('student', 'early_career', 'mid_career', 'executive')
  ),
  CONSTRAINT other_description_required_for_other_lane CHECK (
    (primary_lane != 'other') OR (primary_other_description IS NOT NULL AND LENGTH(primary_other_description) > 0)
  )
);

CREATE INDEX idx_candidate_targeting_profile_id ON candidate_targeting(profile_id);
CREATE INDEX idx_candidate_targeting_primary_lane ON candidate_targeting(primary_lane);

CREATE TRIGGER update_candidate_targeting_updated_at
  BEFORE UPDATE ON candidate_targeting
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

#### Notes on schema

- `primary_sublane` is nullable to support the Other lane (which has no sub-lanes) and edge cases during migration
- `primary_other_description` is required when `primary_lane = 'other'`, enforced by check constraint
- Sub-lane values are NOT enum-constrained at the DB level — validation happens at application layer (per locked decision)
- Lane values ARE enum-constrained because the top-level list is more stable
- Standard `update_updated_at_column()` trigger pattern (assumed to exist; if not, create it as part of this FRD)

#### Migration order

```sql
-- Step 1: Create table
-- Step 2: Run migration script (see section 4.6) to populate from existing users
-- Step 3: Update intake API to write to this table
-- Step 4: Update Positioning/Cover Letter invocations to read from this table
```

### 4.3 signal_applications schema extension

#### Schema changes

```sql
ALTER TABLE signal_applications 
  ADD COLUMN positioning_run_id UUID REFERENCES positioning_runs(id),
  ADD COLUMN coverletter_run_id UUID REFERENCES coverletter_runs(id);

CREATE INDEX idx_signal_applications_positioning_run 
  ON signal_applications(positioning_run_id);

CREATE INDEX idx_signal_applications_coverletter_run 
  ON signal_applications(coverletter_run_id);
```

Both columns nullable. No CASCADE on delete (preserves signal_application if a run is deleted).

#### Shared lookup utility

Extract a shared function from JobFit's existing logic:

```typescript
// /lib/signalApplications.ts

export async function findOrCreateSignalApplication(params: {
  profileId: string;
  companyName: string;
  jobTitle: string;
  jobUrl?: string;
  jobDescription?: string;
  personaId?: string;
  jobfitRunId?: string;
  positioningRunId?: string;
  coverletterRunId?: string;
}): Promise<SignalApplication>;
```

The function:
1. Looks up by `(profile_id, company_name, job_title)` — the existing JobFit lookup key
2. If found, updates whichever run_id field is provided (jobfit_run_id, positioning_run_id, or coverletter_run_id)
3. If not found, creates a new signal_applications row with whichever run_id is provided

#### Caller updates

Three call sites update to use the shared utility:

1. **JobFit route** (`app/api/jobfit/route.ts:377-503`) — existing logic, refactor to use shared utility
2. **Positioning route** (new in Phase 1 FRD) — calls utility with positioning_run_id after creating positioning_run
3. **Cover Letter route** (`app/api/coverletter/route.ts` — currently doesn't update signal_applications) — calls utility with coverletter_run_id after creating coverletter_run

This is a Foundation change because Cover Letter's update was never built. Foundation establishes the pattern; downstream Phase 1 and Cover Letter Integration features consume it.

### 4.4 Career-stage pipe

#### Resolution order

When an API endpoint needs career_stage for a profile:

```typescript
async function resolveCareerStage(profileId: string): Promise<CareerStage> {
  // 1. Primary: candidate_targeting.career_stage (if row exists)
  const targeting = await getCandidate Targeting(profileId);
  if (targeting?.career_stage) {
    return targeting.career_stage;
  }
  
  // 2. Fallback: derive from current_status + yearsExperienceApprox
  return deriveCareerStage(profileId);
}

async function deriveCareerStage(profileId: string): Promise<CareerStage> {
  const currentStatus = await getCurrentStatus(profileId);  // from intake
  const yearsExp = await getYearsExperienceApprox(profileId);  // from resume inference
  
  // Self-identification trumps inference
  if (currentStatus === 'Current student') return 'student';
  
  // Years-based heuristics
  if (currentStatus === 'Recent graduate') return 'early_career';
  
  if (currentStatus === 'Working professional' || currentStatus === 'Career pivot') {
    if (yearsExp === null || yearsExp === undefined) return 'mid_career';  // safe default
    if (yearsExp <= 2) return 'early_career';
    if (yearsExp <= 15) return 'mid_career';
    return 'executive';
  }
  
  // Final fallback
  return 'mid_career';
}
```

#### Manual override

When `career_stage_locked_by = 'manual_override'`, the derivation logic is skipped entirely. The stored value is always returned. This handles edge cases (returning-to-workforce, career-changer with misleading years, etc.).

Manual override can be set via a profile update endpoint (deferred — admin tool or user-initiated update via UI is future work; for v1, set directly in DB if needed).

#### Pipe to invocations

Update API contracts:

**JobFit invocation** (`app/api/jobfit/route.ts`):
- No change required — JobFit doesn't currently use career_stage in evaluation
- Could be added in future if JobFit's evaluation logic needs it
- For Foundation: out of scope

**Positioning invocation** (new in Phase 1 FRD):
- Will read `candidate_targeting` row (or fall back to derivation) at invocation time
- career_stage passed to all downstream Positioning rules
- For Foundation: utility function exposed (`resolveCareerStage`); Positioning consumes it when Phase 1 ships

**Cover Letter invocation** (`app/api/coverletter/route.ts`):
- For Foundation: out of scope (Cover Letter prompts don't currently use career_stage)
- Future Cover Letter Integration FRD may add this

Foundation establishes the utility and the table. Downstream features consume them.

### 4.5 Intake form updates

#### Framer updates required

File: `framer/prod/intakeformcomponent.txt` (also dev mirror per existing workflow)

Current intake captures `target_roles` as free-text. Foundation adds:

**New fields:**

1. **Primary lane selector** (required dropdown or button group)
   - Options: 12 lanes from taxonomy
   - Conditional UI: when "Other" selected, show free-text description field

2. **Primary sub-lane selector** (conditional, required when primary lane has sub-lanes)
   - Options: sub-lanes of the selected primary lane
   - Hidden when "Other" is selected

3. **Secondary lane(s)** (optional, up to 2)
   - Same lane + sub-lane structure
   - UI affordance: "I'm also targeting..." with up to 2 additional lane selectors

4. **Status indicators** (optional checkboxes, multi-select)
   - PreMed
   - PreLaw
   - PreGrad

**Existing fields retained:**

- `current_status` (Current student / Recent graduate / Working professional / Career pivot) — used for career_stage derivation
- `target_roles` (free-text) — retained for backward compatibility; populated alongside new lane selectors during transition; deprecated after migration completes
- Other intake fields — unchanged

#### API contract updates

`POST /api/profile-intake` (or wherever intake submission lands):

**Request payload additions:**
```typescript
{
  // ... existing fields
  targeting: {
    primary_lane: string;
    primary_sublane?: string;
    primary_other_description?: string;
    secondary_lanes?: Array<{ lane: string; sublane?: string }>;
    status_premed?: boolean;
    status_prelaw?: boolean;
    status_pregrad?: boolean;
  };
}
```

**Validation:**
- `primary_lane` must be valid lane id (from taxonomy config)
- `primary_sublane` must be valid sub-lane of `primary_lane` (or null for 'other')
- If `primary_lane = 'other'`, `primary_other_description` is required
- Max 2 secondary lanes
- All secondary lanes must be valid

**Side effects:**
- Creates `candidate_targeting` row with `source = 'intake'`
- Derives initial `career_stage` from current_status + (placeholder for yearsExperienceApprox if resume not yet uploaded)
- Sets `career_stage_locked_by = 'intake'` if explicitly captured, otherwise `'inferred'`

#### Framer-API sync constraint

The investigation report flagged Framer-API coupling as Risk 3. Synchronized deployment required:

1. Framer changes deploy to dev mirror first
2. API changes deploy to dev environment first
3. Verified together in dev
4. Promoted to production as a coordinated release

Out-of-sync deployments silently drop new fields. Strict ordering required.

### 4.6 Migration script

#### Purpose

Backfill `candidate_targeting` rows for all existing users so the new system has data on day one.

#### Approach: Hybrid (Option C from design reference)

**Phase 1: Bulk inference** (one-time job)

For each existing `client_profiles` row:

1. Read `target_roles` (free-text)
2. Read most recent successful JobFit run to get inferred `JobFamily` (if available)
3. Read `current_status` for career_stage derivation
4. Run inference logic:
   - If JobFamily is available and unambiguous → map to lane via `getLaneFromJobFamily()`
   - If JobFamily ambiguous or unavailable → LLM-based inference from target_roles + resume content
   - Sub-lane inference: similar LLM matching to taxonomy
5. Create `candidate_targeting` row with:
   - Inferred lane + sub-lane
   - Derived career_stage
   - `source = 'migration'`
   - `career_stage_locked_by = 'inferred'`

**Phase 2: User verification on next session**

When an existing user with `source = 'migration'` logs in:

1. Show modal/banner: "We've updated our targeting model. Does this look right?"
2. Display inferred primary lane + sub-lane
3. Options:
   - "Yes, looks right" → update `source = 'intake'` (no value change)
   - "No, let me update" → open targeting selector with inferred values pre-populated; user adjusts; update `source = 'intake'`
4. After verification: skip the banner on future sessions

This UI is light friction, not full onboarding.

#### Migration script implementation

```typescript
// scripts/migrate-candidate-targeting.ts

async function migrateCandidateTargeting() {
  const profiles = await getAllClientProfiles();
  
  for (const profile of profiles) {
    // Skip if already has a targeting row
    if (await hasCandidateTargeting(profile.id)) continue;
    
    const inferred = await inferTargeting(profile);
    
    await createCandidateTargeting({
      profile_id: profile.id,
      primary_lane: inferred.primary_lane,
      primary_sublane: inferred.primary_sublane,
      primary_other_description: inferred.primary_other_description,
      career_stage: inferred.career_stage,
      career_stage_locked_by: 'inferred',
      source: 'migration',
    });
  }
}
```

**Inference function** uses LLM (Claude Haiku for cost) with strict prompt:

```
Given a candidate's target_roles text and their most recent JobFit's detected JobFamily,
return the most likely lane and sub-lane from this taxonomy: [LANE_LIST].

If multiple lanes plausibly fit, choose the one with strongest signal.
If no lane fits, return 'other' with a brief description.

Output strict JSON: { lane: string, sublane: string | null, confidence: 'high' | 'medium' | 'low' }
```

Low-confidence inferences should be flagged for manual review (not auto-saved with high confidence).

#### Migration testing

Before running on prod data:

1. Run on dev DB with anonymized prod sample (~50 profiles)
2. Validate inferences manually
3. Adjust inference prompt as needed
4. Re-run until inference accuracy is acceptable (~85%+ for high-confidence)
5. Promote to prod with explicit Peri approval

---

## 5. Implementation phases

### Phase 1: Schema and config

1. Create `/lib/laneTaxonomy.ts` with full taxonomy
2. Create migration SQL for `candidate_targeting` table
3. Create migration SQL for `signal_applications` ALTER TABLE
4. Apply migrations to dev DB (note: schema_migrations dev DB issue — may require SQL Editor workaround per Risk 6)
5. Add validation utilities for taxonomy

### Phase 2: API contract updates

1. Update `/api/profile-intake` to write to `candidate_targeting`
2. Create `/lib/signalApplications.ts` shared utility
3. Refactor JobFit route to use shared utility
4. Expose `resolveCareerStage` utility (consumed by Positioning Phase 1 when that FRD ships)

### Phase 3: Intake form updates

1. Update Framer intake form with new fields
2. Deploy Framer changes to dev mirror
3. Test intake-to-DB flow in dev
4. Synchronize dev API + Framer deployment

### Phase 4: Migration

1. Build migration script
2. Test on anonymized prod sample
3. Build user-verification UI (banner/modal on next session)
4. Run migration on prod data (separate explicit Peri approval)

### Phase 5: Validation and production promotion

1. End-to-end testing in dev (new user intake → candidate_targeting row → JobFit run → signal_applications link)
2. Migration verification (existing users have correctly inferred targeting)
3. User-verification UI testing
4. Production promotion (separate explicit Peri approval per dev-only principle)

---

## 6. Testing strategy

### Unit tests

- Taxonomy validation utilities (valid/invalid lane ids, valid/invalid sub-lane ids)
- JobFamily ↔ Lane mapping (bidirectional)
- Career-stage derivation logic (all branches)
- candidate_targeting CRUD operations

### Integration tests

- Full intake flow: form submission → API validation → DB write
- candidate_targeting read in JobFit (career_stage piped correctly when Positioning is invoked — placeholder until Phase 1 ships)
- findOrCreateSignalApplication utility with all three callers
- Migration script on test data

### Migration verification

- Random sample of migrated profiles checked manually for inference accuracy
- All migrated rows have valid lane/sub-lane combinations
- Career stage derivations match expected values

### Regression tests

- Existing JobFit flow unchanged (signal_applications create/update still works)
- Existing intake fields still captured correctly
- Cover Letter generation unaffected by Foundation changes

---

## 7. Risks and mitigations

Risks from the design reference document, with Foundation-specific mitigations:

### Risk 6: Dev DB schema migration friction

**Impact:** Schema changes can't deploy cleanly to dev because schema_migrations was never seeded.

**Mitigation:** Two options:
1. Repair schema_migrations on dev DB before Foundation work begins (preferred but blocks start)
2. Apply Foundation schema changes via Supabase SQL Editor on dev, document the manual application, fold into proper migration history later

Foundation FRD assumes option 2 unless option 1 happens first.

### Risk 2: Personas Wave 3 in flight

**Impact:** `client_profiles` modifications stack on top of pending refactor.

**Mitigation:** Foundation deliberately uses new `candidate_targeting` table rather than adding columns to `client_profiles`. No conflict.

### Risk 3: Framer-frontend coupling

**Impact:** Intake form lives in Framer; uncoordinated deployments silently drop fields.

**Mitigation:** Strict deployment ordering (section 4.5). Dev mirror updated and tested before any production sync.

### Risk 9: Lane vocabulary is a one-way door

**Impact:** Changing the enum later orphans data.

**Mitigation:** 
- TEXT (not enum) for sub-lanes — easier to evolve
- Lane taxonomy reviewed against actual client engagements before launch (optional Claude Code validation pass)
- Canonical config file — single point of update
- Sub-lane additions are zero-migration (per locked decision)

### Migration accuracy risk

**Impact:** Bulk inference may incorrectly classify existing users.

**Mitigation:**
- Sample testing before production migration
- User-verification UI on next session
- Low-confidence inferences flagged for manual review
- `source = 'migration'` provenance allows distinguishing inferred vs. user-confirmed data

---

## 8. Dependencies

### Blocks

This FRD blocks every Positioning rebuild feature:
- Positioning v2 — Phase 1 (Setup and Scope Calibration)
- Positioning v2 — Phase 2 (Gap Analysis)
- Positioning v2 — Phase 3 (Resume Content Review)
- Positioning v2 — Phase 5 (Change List Output)
- Positioning v2 — Cover Letter Integration
- Positioning v2.5 — Basic Audit Detection
- Positioning v3 — Full Audit Library

### Blocked by

None. This FRD has no upstream dependencies. It's the first piece of Positioning rebuild work.

### External dependencies

- **Wave 3 personas refactor** — not blocking, but Foundation should avoid conflicting changes to `client_profiles`. Confirmed by using separate `candidate_targeting` table.
- **schema_migrations dev DB repair** — preferred prerequisite. If not addressed, manual SQL Editor application is the workaround.

---

## 9. Operational constraints

### Dev-only by default

All changes in this FRD deploy to dev environment first. Production promotion is a separate explicit step requiring Peri's approval.

Specifically:
- Schema migrations: dev DB only until prod promotion approved
- Framer changes: dev mirror only until prod promotion approved
- Migration script: dev sample testing only until prod execution approved
- Code changes: dev branch / dev deployment only until prod promotion approved

### Rollback plan

If Foundation has issues post-deployment:

- **Schema:** `candidate_targeting` table can be dropped (no other tables reference it via FK). `signal_applications` FK columns can be dropped (other code doesn't yet depend on them — Positioning rebuild hasn't shipped).
- **Code:** Application-layer validation falls back to "any TEXT value" if taxonomy config is reverted; not ideal but not catastrophic.
- **Intake:** Old intake form can be redeployed from version control; users continue submitting free-text target_roles.
- **Migration:** Migrated rows in `candidate_targeting` can be deleted; no downstream consumers yet rely on them in v2 (Phase 1 not built yet).

Foundation is uniquely safe to ship and roll back because no downstream features depend on it yet. This is the right place to take measured risks on the new architecture.

---

## 10. Open questions

These remain for design refinement during build:

1. **schema_migrations dev DB repair** — fix before Foundation, or work around during Foundation? Decision affects Foundation's start.

2. **LLM-based inference prompt for migration** — exact prompt design and confidence thresholds need iteration on real data. Plan for 2-3 iterations during dev testing.

3. **User-verification UI specifics** — modal vs. banner vs. inline prompt. Worth a quick UX decision before Phase 4 of implementation.

4. **Career stage during intake without resume** — if user completes intake before uploading resume, `yearsExperienceApprox` is unavailable. Default to `mid_career` per derivation logic, or hold off on creating candidate_targeting row until resume is uploaded?

5. **Manual override admin tool** — not in Foundation scope, but worth flagging: if coaches need to override career stage for clients, where does that UI live? Likely a future feature.

---

## 11. Acceptance criteria

Foundation is complete when:

- ✅ Lane taxonomy config file exists with all 11 lanes + Other and ~45 sub-lanes
- ✅ `candidate_targeting` table exists in dev DB with full schema
- ✅ `signal_applications` has `positioning_run_id` and `coverletter_run_id` columns
- ✅ Shared `findOrCreateSignalApplication` utility exists and is consumed by JobFit
- ✅ `resolveCareerStage` utility exists and is testable
- ✅ Intake form (dev mirror) captures lane + sub-lane + secondary lanes + status indicators
- ✅ API endpoint accepts new intake payload and writes to `candidate_targeting`
- ✅ Migration script runs successfully on test sample with ≥85% high-confidence accuracy
- ✅ User-verification UI works in dev
- ✅ All tests pass (unit, integration, regression)
- ✅ No regressions in existing JobFit, Positioning, or Cover Letter flows

Production promotion requires separate Peri approval.

---

## 12. References

- **Design reference document:** `C:\Users\perig\wrnsignal-api\docs\positioning-design-reference-v2.md`
- **Investigation report:** Claude Code application-prep architecture investigation (in design conversation history)
- **JobFamily enum:** `app/api/jobfit/signals.ts:10-26`
- **signal_applications schema:** `prod_public_schema.sql:790-814`
- **client_profiles schema:** `prod_public_schema.sql:169-195`
- **Existing JobFit signal_applications creation:** `app/api/jobfit/route.ts:377-503`
- **Intake form:** `framer/prod/intakeformcomponent.txt:502-526` (current_status), `framer/prod/intakeformcomponent.txt:409-414` (target_roles)
- **Years experience inference:** `app/api/profile-intake/route.ts:164-240` (inferYearsExperienceApprox)
