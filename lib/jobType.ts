// lib/jobType.ts
//
// Canonical job_type vocabulary, shared by every job_type surface (coach
// prospect form, coach Profile & Personas form, D2C dashboard/profile, intake,
// and the API routes). Defined once here so the vocabulary can't drift again
// (it previously diverged into 'Full Time Role' / 'Full Time' / 'Full-time').
// Spec: docs/job-type-overhaul-spec.md §10 step 2.
//
// Plain constants module — no "use client", no server-only imports — so it is
// safe to import from both client components and server routes.
//
// SCOPE: this step DEFINES the constant only. Rewiring each form/route to
// import it, and the validator/normalizer helper, are later per-surface steps.

export const JOB_TYPE_OPTIONS = [
  "Full-time",
  "Part-time",
  "Internship",
  "Contract",
  "Any",
] as const

export type JobType = (typeof JOB_TYPE_OPTIONS)[number]
