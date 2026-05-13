# Positioning Design Reference (v2 — Post-Investigation)

**Status:** Design captured + grounded in current implementation. Ready for FRD drafting and PM restructuring.
**Authors:** Peri Ginsberg; design conversation with Claude.
**Supersedes:** positioning-design-reference.md (v1)

---

## Purpose

This document captures the complete design for SIGNAL's Positioning rebuild, grounded in the Claude Code investigation of the current application-prep architecture. It includes the original design conversation outputs plus the investigation findings and build sequencing decisions made afterward.

This is **not** an FRD. It's the design reference that informs FRDs. FRDs follow per-feature as work begins.

---

## Product architecture

SIGNAL has three product surfaces for application preparation, plus a fourth shipping product (Cover Letter):

### JobFit (exists today; stays minimal)
- **Question answered:** "Is this job right for me?"
- **What it does:** Scores content fit between resume and JD. Returns verdict (Priority Apply / Apply / Review / Pass).
- **Role:** Triage. Helps user decide whether to pursue.
- **Investigation confirmed:** V5 already produces structured `positioning_strategy`, `risk_structured`, and `risk_codes`. These exist but are not piped to Positioning today. Rebuild work includes establishing this pipe.

### Positioning (rebuild target)
- **Question answered:** "How do I make my resume competitive for this specific job?"
- **What it does:** Interactive per-job resume tailoring environment.
- **Role:** The substantive work happens here. User exits with concrete change list.
- **Investigation confirmed:** Today's Positioning is shallow — regex bullet extraction + summary presence detection + LLM judgment on alignment. Returns prose outputs Cover Letter can only consume textually. Rebuild is substantial.

### Cover Letter (exists today; shipping)
- **Question answered:** "What does my cover letter for this job say?"
- **What it does:** Generates cover letter from resume + JD + optional JobFit/Positioning context.
- **Role:** Sibling product to Positioning, downstream in per-application workflow.
- **Investigation confirmed:** Today's Cover Letter optionally consumes JobFit's `cover_letter_strategy` and Positioning's prose outputs. Rebuild work includes consuming new structured Positioning output via updates to `extractCoverLetterStrategy()` and `summarizePositioning()`.

### Resume Audit (designed; on hold)
- **Question answered:** "Is my resume good in general?"
- **Status:** Fully designed; on hold. Rule libraries (20 ATS + 33 Formatting Quality) preserved and reused in Positioning's Phase 4.

---

## Five foundational design principles

These govern all SIGNAL evaluation and recommendation behavior:

### 1. Agency Principle
SIGNAL evaluates and informs; SIGNAL does not gate.

### 2. Honesty Principle
Affirmation when warranted, prescription when warranted, silence when neither is. Don't manufacture findings to demonstrate value.

### 3. Outcome-Based Rules Principle
Measure outcomes where possible; enforce inputs only when outcomes are unmeasurable. "1-inch margins" is not enforced; readability outcomes are.

### 4. Attention Budget Principle
Design for the cost of cognitive load on the reader. "Train the eye." Every formatting choice spends from or returns to the recruiter's 7-second-scan budget.

### 5. Scaled Customization Principle
Customization is not justification. Positioning scales to the work that's actually needed.

---

## Current state of application-prep architecture (from investigation)

### The unifying record exists: `signal_applications`

`signal_applications` (prod_public_schema.sql:790-814) is auto-created when JobFit runs. Fields include:
- profile_id, persona_id, jobfit_run_id
- company_name, job_title, location, job_url
- application_status, applied_date, cover_letter_submitted
- signal_decision, signal_score, signal_run_at

This is the unifying entity for application prep. **Decision (locked):** extend this entity with `positioning_run_id` and `coverletter_run_id` FKs rather than inventing a new "application prep session" object.

### Today's data flow is independent leaf nodes

```
Frontend → POST /api/jobfit          → decision, why_structured, risk_structured, cover_letter_strategy
Frontend → POST /api/positioning      → role_angle, summary, bullet_edits  (no JobFit input)
Frontend → POST /api/coverletter      → letter  (optional JobFit + Positioning context)
```

Positioning is JobFit-blind today. Cover Letter optionally consumes both but they're independent invocations.

### JobFit V5 already produces structured positioning data

`positioning_strategy` (lead_section, reframe, tone — null on Pass)
`risk_structured` (keyword, gap, reframe, severity)
`risk_codes` (string codes like YEARS_EXPERIENCE_GAP)

These exist in JobFit output today. Positioning doesn't consume them. **Rebuild work includes piping these into Positioning's Phase 2 gap analysis and Phase 3 content review.**

### Lane vocabulary does not exist user-facing

- `JobFamily` enum (signals.ts:10-26) — 16 families. Engine-internal, JD-derived, not user-selected.
- `target_roles` — free-text intake field.

**Decision (locked):** Design new user-facing lane taxonomy that maps to JobFamily internally. The JobFamily labels ("PreMed," "IT_Software") aren't ideal user-facing labels; mapping is cheap if done once.

### Career-stage detection exists but isn't piped

- `current_status` (text from intake): "Current student" / "Recent graduate" / "Working professional" / "Career pivot"
- `yearsExperienceApprox` (inferred from resume by `inferYearsExperienceApprox()`)

Both available; neither piped to Positioning. **Rebuild work includes piping these to Positioning invocations.**

### Resume audit detection in code today: shallow

Regex bullet extraction + summary presence detection only. No structural quality analysis. **All audit detection rules from the Resume Audit design work are net-new engineering**, scoped to subsets in v2.5 and v3 (see Build Sequencing below).

### Resume version handling exists via personas

`client_personas` rows = resume versions. Each persona is a resume version with `is_default` flag. Re-upload creates a new persona row; Phase 4's address-now flow uses this existing infrastructure.

---

## Positioning workflow: five phases

### Phase 1: Setup and Inheritance

**Purpose:** Orient the user, establish context, calibrate to scope of work.

**What the user sees:**
- Confirmation of context (job, JobFit timestamp, JobFit verdict)
- Framing of what Positioning is vs. JobFit
- Preview of JobFit's gap findings
- Time expectation

**Three calibration cases:**
- **Case A: Well-positioned.** Resume already tells the right story. Brief workflow.
- **Case B: Targeted changes needed.** Most common. Full workflow.
- **Case C: Significant repositioning.** Resume tells a different story than this job is asking for. Includes "reconsider target" framing.

**Pass verdict handling (locked):** Positioning runs regardless of JobFit verdict (Agency Principle). A Pass verdict forces Case C calibration with "reconsider the target" framing prominent. User can proceed with substantial repositioning if they choose.

**Inheritance contract (from JobFit):**
- verdict + score
- why_structured + risk_structured + risk_codes
- cover_letter_strategy (legacy; may be deprecated)
- job_signals + profile_signals
- JD content
- Resume document hash
- Career stage (current_status + yearsExperienceApprox) — must be piped through

### Phase 2: Gap Analysis

**Purpose:** For each gap JobFit identified, engage the candidate to determine if the gap is real or unsurfaced.

**Four gap categories:**
1. Skill keyword gaps
2. Experience type gaps
3. Domain/industry gaps
4. Seniority/scope gaps

**Conversation pattern:**
1. Name the gap specifically
2. Frame honestly (real vs. unsurfaced)
3. Ask the right question
4. Capture response
5. Generate recommendation based on response

**Sequential by default**, optional "show all" toggle.

**Skips entirely** when no significant gaps exist (Scaled Customization).

**Ask-don't-invent throughout:** SIGNAL never assumes candidate has or lacks skills. Surfaces gaps and asks questions; candidate provides actual experience.

### Phase 3: Resume Content Review

**Purpose:** Walk through resume section-by-section with JD as lens.

**Section sequence:**
1. Headline
2. Summary statement (if present, or recommended add)
3. Skills section
4. Experience bullets
5. Section ordering

**Three bullet categories:**
- Aligned (keep)
- Reframable (surface JD-relevant angle through candidate confirmation)
- Non-aligned (de-emphasize, replace, cut)

**Throughout:**
- "I want to discuss" / "Keep current" options
- Keep current doesn't require justification
- All decisions captured for Phase 5 output
- Length scales with case

### Phase 4: ATS and Formatting in Application Context

**Purpose:** Surface ATS and formatting issues affecting this specific application.

**Scope by release** (locked):
- **v2:** Phase 4 stub. No audit detection yet. User sees "Audit issue detection coming in next release."
- **v2.5:** Basic audit detection. 7 BLOCKING ATS rules + 10 high-impact formatting rules (see Build Sequencing).
- **v3:** Full audit library. ~40 rules carried from Resume Audit design.

**Organization:**
- Critical: Address before submitting (BLOCKING)
- Recommended: Strengthens this application (HIGH_RISK + ADVISORY)

**Three user actions per issue:**
- Address now (re-upload flow using existing persona infrastructure)
- Defer (apply anyway; captured as known issue)
- Dismiss (user disagrees; captured for product learning)

Defer friction proportionate to severity.

### Phase 5: Output — The Change List

**Purpose:** Present captured decisions as unified, prioritized, actionable change list.

**Priority ordering:**
1. Critical to address before applying
2. Substantive positioning changes
3. Bullet-level work
4. Structural/formatting improvements
5. Deferred items (for transparency)

**Per-item format:**
- Checkbox (persists)
- Current state vs. recommended
- "Why" reasoning for substantive items
- Edit / Use-as-is options for generated content
- Skip option

**Export:** PDF, email, print.

**Output contract designed for downstream consumers:**
- Manual user action (today)
- Cover Letter integration (immediate — v2)
- Future rewrite product

---

## Architectural decisions

### Captured session record = signal_applications + linked runs

The signal_applications row is the captured session record. Once we add `positioning_run_id` and `coverletter_run_id` FKs, the application record holds the full prep state:

- jobfit_run_id → JobFit's verdict, gap analysis, structured outputs
- positioning_run_id → Positioning's session record (all Phase 2-5 captured decisions)
- coverletter_run_id → Cover Letter output
- application_status → user's progress through the workflow

No new entity needed. The session record concept maps to the existing application record.

### Positioning's new output contract

Today's Positioning returns:
```
{ student_intro, role_angle, arrange_resume, summary_statement, 
  resume_bullet_edits, keyword_analysis, fingerprint_code, 
  fingerprint_hash, reused }
```

Rebuilt Positioning returns (extending, with backward-compat fields preserved):
```
{
  // Backward-compat fields (legacy Cover Letter consumes these)
  student_intro, role_angle, arrange_resume, summary_statement,
  resume_bullet_edits, keyword_analysis,
  
  // New structured fields
  case: "A" | "B" | "C",
  scope_signal: { ... },
  gap_analysis: { gaps: [...], responses: [...] },
  content_review: { 
    headline: { ... },
    summary: { ... },
    skills: { ... },
    bullets: [{ ... }],
    section_order: { ... }
  },
  audit_findings: [{ ... }],  // null/empty in v2; populated in v2.5+
  change_list: [{ ... }],
  positioning_strategy: { lead_section, reframe, tone },  // Cover Letter consumes
  
  // Metadata
  fingerprint_code, fingerprint_hash, reused
}
```

The new `positioning_strategy` field becomes Cover Letter's primary input via `extractCoverLetterStrategy()` updates.

### candidate_targeting table

New table for lane + career-stage data, avoiding `client_profiles` churn during Wave 3:

```
candidate_targeting:
  id
  profile_id (FK)
  lane (enum from new user-facing taxonomy)
  career_stage (derived from current_status + yearsExperienceApprox)
  career_stage_locked_by (intake | inferred)
  updated_at
```

Lane is set at intake (selection from new taxonomy). Career stage is derived but can be locked if intake captures it explicitly.

### Pass-aware Positioning behavior

JobFit Pass verdict → Positioning runs but:
- Case C calibration forced
- "Reconsider the target" framing prominent in Phase 1
- Phase 2 gap analysis surfaces gaps with stronger language about their severity
- Phase 5 change list more likely to be substantial

This is consistent with Agency Principle while honoring JobFit's signal.

---

## Build sequencing — three releases

### Positioning v2 (the workflow release)

**Foundation work:**
- Lane taxonomy design (new user-facing enum, mapped to JobFamily)
- candidate_targeting table
- signal_applications linkage (positioning_run_id, coverletter_run_id FKs)
- Career-stage pipe (current_status + yearsExperienceApprox → Positioning invocations)
- Intake form updates (lane selector)

**Workflow features:**
- Phase 1: Setup and Inheritance with three-case calibration
- Phase 2: Gap Analysis (consuming JobFit risk_structured + risk_codes)
- Phase 3: Resume Content Review (section-by-section walkthrough)
- Phase 5: Change List output (with Phase 4 stubbed — audit findings empty)
- Cover Letter integration (extractCoverLetterStrategy + summarizePositioning updates)

**What v2 does NOT include:** Phase 4 audit detection. If a user's resume has ATS issues, v2 won't catch them. The Change List excludes audit-related items.

### Positioning v2.5 (basic audit detection)

**Engineering scope:** Build structural resume analysis infrastructure (parser extensions from Feature 1A design), then implement the v2.5 rule subset.

**v2.5 rule subset — 17 rules total:**

BLOCKING ATS rules (7):
- Multi-column layouts and layout tables (Rule 2A-1.1)
- Text boxes / floating elements (Rule 2A-1.3)
- Headers and footers containing critical content (Rule 2A-1.4)
- Embedded images containing text (Rule 2A-1.5)
- Image-based PDF (Rule 2A-1.6)
- File format (Rule 2A-4.1)
- Password-protected file (Rule 2A-4.4)

High-impact deterministic formatting rules (10):
- Typos / spelling — Class 1 (Rule 3A-4.6)
- Page count by career stage (Rule 3A-5.1)
- Passive voice (Rule 3A-3.1)
- Weak action verbs (Rule 3A-3.2)
- First-person pronouns (Rule 3A-4.7)
- Objective statement present (Rule 3A-6.1)
- References section present (Rule 3A-6.2)
- Inappropriate email address (Rule 3A-6.8)
- GPA inclusion threshold (Rule 3A-6.9)
- High school information for college graduates (Rule 3A-6.10)

Selection criteria: all deterministic (no LLM judgment), high coaching value, common issues. Defers all LLM-judged rules and most context-dependent rules to v3.

### Positioning v3 (full audit library)

**Remaining work:**
- All HIGH_RISK and ADVISORY ATS rules (13 remaining from Feature 2A)
- All remaining formatting rules across Dimensions 1-6 (~25 rules)
- LLM-judged rules: bullet value test, accomplishment framing, single-lane targeting blind-read, scan readiness, summary statement quality, grammar (Class 2)
- Career-stage-modulated rules with full branching logic
- Recommendation generation for all rules

This is the heaviest engineering. Defers cleanly behind v2 and v2.5.

---

## Risks and constraints (from investigation)

### Architectural risks

**Wave 3 personas refactor in flight.** Adding columns to `client_profiles` now risks entanglement. **Mitigation:** candidate_targeting as separate table (locked decision).

**Framer-frontend coupling.** Intake form lives in framer/prod/intakeformcomponent.txt. Lane selector requires synchronized Framer + API + dev/prod mirror edits. Out-of-sync deployments silently drop new fields.

**Dev DB schema migration friction.** db push fails on dev because schema_migrations was never seeded. New column additions require SQL Editor workarounds until repaired.

**Lane vocabulary is a one-way door.** Once users select from enum, changing it orphans data. Get vocabulary right before launch.

### Performance risks

**LLM latency stacking.** JobFit + Positioning + Cover Letter + Networking sums to 1-2s per job. Parallelize where possible; cache aggressively.

**Prompt context limits.** Long resumes (~5000+ tokens) already squeeze GPT-4.1-mini. Adding lane + JD + gap findings + Phase 4 rules pushes further. **May need resume-summarizer pre-step** — flag for design when prompt engineering work begins.

### Operational risks

**JobFit V5 silent fallback.** If V5 bullet generation fails, `cover_letter_strategy` is absent. Rebuilt Positioning may inherit this. Surface failures explicitly when Positioning becomes dependent on V5 outputs.

**Caching invalidation.** Adding lane to Positioning fingerprint busts all existing cached runs. Consider `fingerprint_schema_version` column to avoid future drift.

---

## Open questions

These remain to be resolved during FRD drafting and design refinement:

1. **Lane taxonomy specifics.** What are the user-facing lanes? Likely close to JobFamily but with friendlier labels. Needs user testing or product judgment.

2. **Mapping logic for legacy users.** Existing users have free-text target_roles. Migration to enum-based lane requires either bulk inference or user-prompted selection on next session.

3. **Career-stage thresholds.** Student (0-2 years), mid-career (3-15), executive (15+) — these were locked in design but should be confirmed against intake data realities.

4. **Phase 4 audit findings in v2.** Should the Change List in v2 explicitly say "audit detection coming next release," or simply not mention it? Honesty Principle says explicit acknowledgment is better.

5. **Resume-summarizer pre-step.** May be needed for prompt context limits. Design decision: does this happen at upload (cached), at invocation (fresh), or hybrid?

6. **Pass-verdict UX specifics.** "Reconsider the target" framing — exact copy and visual treatment. Refine during Phase 1 FRD.

---

## What's preserved from Resume Audit design

Available for use in v2.5 and v3:

- 20 ATS Compliance rules (Feature 2A design)
- 33 Formatting Quality rules across 6 dimensions (Feature 3A design)
- Section header anchor list (21 anchors)
- Three-verdict color system (green/amber/red)
- Caching architecture (content-hash-keyed)
- Output contract structure
- Pattern-match logic for section header detection

---

## Next steps

1. **PM restructuring** — Move existing Resume Audit features to paused. Create Positioning v2 features. Create v2.5 and v3 placeholder features.

2. **FRD drafting per feature** — Beginning with Positioning Foundation (the prerequisite for everything else).

3. **Lane taxonomy design session** — Separate work, gates intake form updates and v2 invocations.

4. **Resume-summarizer pre-step decision** — May need its own design conversation if prompt context limits hit early.

5. **Build begins** — Foundation features ship first, workflow features follow.
