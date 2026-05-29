/**
 * DEV-ONLY: Positioning v2 feedback page.
 *
 * Standalone dev-only route. A tester opens it with the run + profile in
 * the query string:
 *
 *   /feedback/positioning?run_id=<positioning_runs_v2.id>&profile_id=<client_profiles.id>
 *
 * Renders the shared FeedbackForm wired to /api/feedback/positioning. This
 * page IS the frontend dev fence: when isDevEnvironment() is false it 404s
 * (notFound), so the route disappears entirely outside dev. See
 * lib/devOnly.ts; the positioning_feedback migration is marked ❌ never on prod.
 */

import { notFound } from 'next/navigation';
import { DevFeedbackForm, FeedbackCategory } from '@/components/feedback/DevFeedbackForm';
import { isDevEnvironment } from '@/lib/devOnly';

// Mirrors VALID_CATEGORIES in app/api/feedback/positioning/route.ts.
const POSITIONING_CATEGORIES: FeedbackCategory[] = [
  { value: 'wrong_case', label: 'Wrong case' },
  { value: 'bad_reasoning', label: 'Bad reasoning' },
  { value: 'bad_workflow_preview', label: 'Bad workflow preview' },
  { value: 'wrong_gap_count', label: 'Wrong gap count' },
  { value: 'bad_case_specific_content', label: 'Bad case-specific content' },
  { value: 'other', label: 'Other' },
];

export default async function PositioningFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ run_id?: string; profile_id?: string }>;
}) {
  // Page-level dev fence — route 404s outside dev. See lib/devOnly.ts.
  if (!isDevEnvironment()) notFound();

  const sp = await searchParams;
  const runId = typeof sp.run_id === 'string' ? sp.run_id : '';
  const profileId = typeof sp.profile_id === 'string' ? sp.profile_id : '';

  if (!runId || !profileId) {
    return (
      <div style={messageStyle}>
        <h1 style={messageHeadingStyle}>Missing query parameters</h1>
        <p>
          This dev-only feedback page needs <code>run_id</code> and{' '}
          <code>profile_id</code> in the URL.
        </p>
        <p style={{ fontSize: 13, color: '#6b7280' }}>
          Example:{' '}
          <code>/feedback/positioning?run_id=&lt;positioning_runs_v2.id&gt;&amp;profile_id=&lt;client_profiles.id&gt;</code>
        </p>
      </div>
    );
  }

  return (
    <DevFeedbackForm
      endpoint="/api/feedback/positioning"
      categories={POSITIONING_CATEGORIES}
      payloadExtras={{ positioning_run_id: runId, profile_id: profileId }}
      surfaceLabel="Positioning"
    />
  );
}

const messageStyle: React.CSSProperties = {
  maxWidth: 560,
  margin: '40px auto',
  padding: 32,
  fontFamily: 'system-ui, sans-serif',
  color: '#374151',
  lineHeight: 1.5,
};

const messageHeadingStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  color: '#111827',
  marginTop: 0,
};
