/**
 * DEV-ONLY: JobFit feedback capture endpoint.
 *
 * POST /api/feedback/jobfit
 *
 * Accepts a rating + categories + optional freetext, writes one row
 * to jobfit_feedback. Multiple rows per (run, profile) are allowed by
 * design (re-rating after code changes is expected; query latest in SQL).
 *
 * This route MUST NEVER ship to prod. Guarded by assertDevEnvironment()
 * as the first line of the handler. The jobfit_feedback table does not
 * exist on prod (migration marked ❌ never), so even if this assertion
 * were bypassed, the INSERT would fail. Defense in depth.
 *
 * See lib/devOnly.ts for the fence design.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertDevEnvironment } from '@/lib/devOnly';

const VALID_RATINGS = ['good', 'mixed', 'bad'] as const;
type Rating = (typeof VALID_RATINGS)[number];

const VALID_CATEGORIES = [
  'wrong_verdict',
  'wrong_score',
  'bad_why_bullets',
  'bad_risk_bullets',
  'wrong_job_family',
  'wrong_rationale',
  'other',
] as const;

type FeedbackPayload = {
  jobfit_run_id: string;
  rating: Rating;
  categories?: string[];
  feedback_text?: string;
};

export async function POST(req: NextRequest) {
  // Fence: throws in non-dev environments. Caught below and returned as 500.
  try {
    assertDevEnvironment('feedback/jobfit POST');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'devOnly guard failed';
    return NextResponse.json(
      { error: 'dev_only_endpoint', message },
      { status: 500 }
    );
  }

  let body: FeedbackPayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid_json', message: 'Request body is not valid JSON.' },
      { status: 400 }
    );
  }

  // Required fields
  if (!body.jobfit_run_id || typeof body.jobfit_run_id !== 'string') {
    return NextResponse.json(
      { error: 'missing_jobfit_run_id' },
      { status: 400 }
    );
  }
  if (!VALID_RATINGS.includes(body.rating)) {
    return NextResponse.json(
      { error: 'invalid_rating', message: `rating must be one of ${VALID_RATINGS.join(', ')}` },
      { status: 400 }
    );
  }

  // Sanitize categories: only allow known values, dedupe.
  const categories: string[] = Array.isArray(body.categories)
    ? Array.from(new Set(body.categories.filter((c) => VALID_CATEGORIES.includes(c as never))))
    : [];

  const feedbackText =
    typeof body.feedback_text === 'string' && body.feedback_text.trim().length > 0
      ? body.feedback_text.trim()
      : null;

  // Mirror the DB CHECK constraint at the route layer for a cleaner error.
  if (body.rating !== 'good' && categories.length === 0 && !feedbackText) {
    return NextResponse.json(
      {
        error: 'detail_required',
        message: "Ratings of 'mixed' or 'bad' require at least one category or freetext.",
      },
      { status: 400 }
    );
  }

  // Service-role client — dev-only route, dev Supabase, no RLS concerns.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Resolve the owning profile from the run row. The client never sends
  // profile_id — the Framer surfaces don't expose client_profiles.id by
  // design — so we derive it from jobfit_runs.client_profile_id. The link
  // only needs ?run_id=.
  const { data: runRow, error: runErr } = await supabase
    .from('jobfit_runs')
    .select('client_profile_id')
    .eq('id', body.jobfit_run_id)
    .maybeSingle();

  if (runErr) {
    // Most commonly an invalid UUID (pg 22P02) — treat as bad input.
    return NextResponse.json(
      { error: 'run_lookup_failed', message: runErr.message },
      { status: 400 }
    );
  }
  if (!runRow) {
    return NextResponse.json(
      { error: 'run_not_found', message: 'No jobfit_runs row for that run_id.' },
      { status: 404 }
    );
  }
  const profileId = runRow.client_profile_id as string | null;
  if (!profileId) {
    return NextResponse.json(
      { error: 'run_missing_profile', message: 'Run has no associated profile.' },
      { status: 422 }
    );
  }

  const { data, error } = await supabase
    .from('jobfit_feedback')
    .insert({
      jobfit_run_id: body.jobfit_run_id,
      profile_id: profileId,
      rating: body.rating,
      categories,
      feedback_text: feedbackText,
    })
    .select('id, created_at')
    .single();

  if (error) {
    console.error('[feedback/jobfit] insert failed', {
      jobfit_run_id: body.jobfit_run_id,
      profile_id: profileId,
      pg_code: error.code,
      pg_message: error.message,
    });
    return NextResponse.json(
      { error: 'insert_failed', message: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { id: data!.id, created_at: data!.created_at },
    { status: 201 }
  );
}
