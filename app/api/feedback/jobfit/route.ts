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
  profile_id: string;
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
  if (!body.profile_id || typeof body.profile_id !== 'string') {
    return NextResponse.json(
      { error: 'missing_profile_id' },
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

  const { data, error } = await supabase
    .from('jobfit_feedback')
    .insert({
      jobfit_run_id: body.jobfit_run_id,
      profile_id: body.profile_id,
      rating: body.rating,
      categories,
      feedback_text: feedbackText,
    })
    .select('id, created_at')
    .single();

  if (error) {
    console.error('[feedback/jobfit] insert failed', {
      jobfit_run_id: body.jobfit_run_id,
      profile_id: body.profile_id,
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
