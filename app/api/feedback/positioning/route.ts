/**
 * DEV-ONLY: Positioning v2 feedback capture endpoint.
 *
 * POST /api/feedback/positioning
 *
 * Mirror of /api/feedback/jobfit, scoped to positioning_runs_v2.
 * See that route's header for the full fence rationale.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertDevEnvironment } from '@/lib/devOnly';

const VALID_RATINGS = ['good', 'mixed', 'bad'] as const;
type Rating = (typeof VALID_RATINGS)[number];

const VALID_CATEGORIES = [
  'wrong_case',
  'bad_reasoning',
  'bad_workflow_preview',
  'wrong_gap_count',
  'bad_case_specific_content',
  'other',
] as const;

type FeedbackPayload = {
  positioning_run_id: string;
  profile_id: string;
  rating: Rating;
  categories?: string[];
  feedback_text?: string;
};

export async function POST(req: NextRequest) {
  try {
    assertDevEnvironment('feedback/positioning POST');
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

  if (!body.positioning_run_id || typeof body.positioning_run_id !== 'string') {
    return NextResponse.json(
      { error: 'missing_positioning_run_id' },
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

  const categories: string[] = Array.isArray(body.categories)
    ? Array.from(new Set(body.categories.filter((c) => VALID_CATEGORIES.includes(c as never))))
    : [];

  const feedbackText =
    typeof body.feedback_text === 'string' && body.feedback_text.trim().length > 0
      ? body.feedback_text.trim()
      : null;

  if (body.rating !== 'good' && categories.length === 0 && !feedbackText) {
    return NextResponse.json(
      {
        error: 'detail_required',
        message: "Ratings of 'mixed' or 'bad' require at least one category or freetext.",
      },
      { status: 400 }
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await supabase
    .from('positioning_feedback')
    .insert({
      positioning_run_id: body.positioning_run_id,
      profile_id: body.profile_id,
      rating: body.rating,
      categories,
      feedback_text: feedbackText,
    })
    .select('id, created_at')
    .single();

  if (error) {
    console.error('[feedback/positioning] insert failed', {
      positioning_run_id: body.positioning_run_id,
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
