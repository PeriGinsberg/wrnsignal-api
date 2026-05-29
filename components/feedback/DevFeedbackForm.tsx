/**
 * DEV-ONLY: Feedback form component for the dedicated dev feedback pages.
 *
 * NOTE: distinct from components/feedback/FeedbackForm.tsx, which is the
 * shipped beta-feedback slide-in form (different contract). This one is the
 * dev-only JobFit/Positioning rating form with a configurable endpoint.
 *
 * Used by:
 *   - app/feedback/jobfit/page.tsx
 *   - app/feedback/positioning/page.tsx
 *
 * Renders a three-state rating, constrained categories multi-select,
 * and optional freetext. Submits to a configurable API endpoint.
 *
 * The page-level dev fence (isDevEnvironment() check in the page
 * component) means this form only renders in dev. See lib/devOnly.ts.
 */

'use client';

import { useState } from 'react';

type Rating = 'good' | 'mixed' | 'bad';

export type FeedbackCategory = {
  value: string;
  label: string;
};

type DevFeedbackFormProps = {
  endpoint: string;
  categories: FeedbackCategory[];
  payloadExtras: Record<string, string>;
  surfaceLabel: string;
};

export function DevFeedbackForm({
  endpoint,
  categories,
  payloadExtras,
  surfaceLabel,
}: DevFeedbackFormProps) {
  const [rating, setRating] = useState<Rating | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [feedbackText, setFeedbackText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsDetail = rating === 'mixed' || rating === 'bad';
  const canSubmit =
    rating !== null &&
    (!needsDetail || selectedCategories.length > 0 || feedbackText.trim().length > 0);

  const toggleCategory = (value: string) => {
    setSelectedCategories((current) =>
      current.includes(value)
        ? current.filter((c) => c !== value)
        : [...current, value]
    );
  };

  const reset = () => {
    setRating(null);
    setSelectedCategories([]);
    setFeedbackText('');
    setError(null);
    setSubmitted(false);
  };

  const handleSubmit = async () => {
    if (!canSubmit || !rating) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payloadExtras,
          rating,
          categories: selectedCategories,
          feedback_text: feedbackText.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(json.message || `HTTP ${res.status}`);
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div style={cardStyle}>
        <div style={successStyle}>✓ Feedback recorded</div>
        <p style={{ color: '#4b5563', margin: '8px 0 16px' }}>
          Thanks. You can close this tab, or rate something else.
        </p>
        <button type="button" onClick={reset} style={secondaryButtonStyle}>
          Rate another
        </button>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <h1 style={headingStyle}>Rate this {surfaceLabel}</h1>
      <p style={subheadingStyle}>
        Dev-only feedback capture. Not visible to clients.
      </p>

      <div style={{ marginBottom: 20 }}>
        <div style={labelStyle}>How was this result?</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['good', 'mixed', 'bad'] as Rating[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRating(r)}
              style={{
                ...ratingButtonStyle,
                ...(rating === r ? ratingButtonActiveStyle(r) : {}),
              }}
            >
              {r === 'good' ? '👍 Good' : r === 'mixed' ? '😐 Mixed' : '👎 Bad'}
            </button>
          ))}
        </div>
      </div>

      {needsDetail && (
        <>
          <div style={{ marginBottom: 20 }}>
            <div style={labelStyle}>What's off? (pick any that apply)</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {categories.map((cat) => (
                <button
                  key={cat.value}
                  type="button"
                  onClick={() => toggleCategory(cat.value)}
                  style={{
                    ...chipStyle,
                    ...(selectedCategories.includes(cat.value) ? chipActiveStyle : {}),
                  }}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <div style={labelStyle}>Notes (optional)</div>
            <textarea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="What did you expect to see? What was wrong?"
              rows={5}
              style={textareaStyle}
            />
          </div>
        </>
      )}

      {error && (
        <div style={errorStyle}>
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit || submitting}
        style={{
          ...submitButtonStyle,
          opacity: canSubmit && !submitting ? 1 : 0.5,
          cursor: canSubmit && !submitting ? 'pointer' : 'not-allowed',
        }}
      >
        {submitting ? 'Saving…' : 'Submit feedback'}
      </button>
    </div>
  );
}

// =====================================================================
// Styles
// =====================================================================

const cardStyle: React.CSSProperties = {
  maxWidth: 560,
  margin: '40px auto',
  padding: 32,
  background: 'white',
  borderRadius: 12,
  border: '1px solid #e5e7eb',
  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
};

const headingStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 600,
  margin: 0,
  color: '#111827',
};

const subheadingStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#6b7280',
  margin: '4px 0 24px',
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: '#374151',
  marginBottom: 10,
};

const ratingButtonStyle: React.CSSProperties = {
  flex: 1,
  padding: '12px 16px',
  border: '1px solid #d1d5db',
  background: 'white',
  borderRadius: 8,
  fontSize: 14,
  cursor: 'pointer',
  fontWeight: 500,
};

const ratingButtonActiveStyle = (r: Rating): React.CSSProperties => ({
  background: r === 'good' ? '#dcfce7' : r === 'mixed' ? '#fef3c7' : '#fee2e2',
  borderColor: r === 'good' ? '#16a34a' : r === 'mixed' ? '#d97706' : '#dc2626',
  color: r === 'good' ? '#166534' : r === 'mixed' ? '#92400e' : '#991b1b',
});

const chipStyle: React.CSSProperties = {
  padding: '6px 12px',
  border: '1px solid #d1d5db',
  background: 'white',
  color: '#111827',
  borderRadius: 999,
  fontSize: 13,
  cursor: 'pointer',
};

const chipActiveStyle: React.CSSProperties = {
  background: '#1f2937',
  color: 'white',
  borderColor: '#1f2937',
};

const textareaStyle: React.CSSProperties = {
  width: '100%',
  padding: 12,
  border: '1px solid #d1d5db',
  color: '#111827',
  background: 'white',
  borderRadius: 6,
  fontSize: 14,
  fontFamily: 'inherit',
  resize: 'vertical',
  boxSizing: 'border-box',
};

const submitButtonStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 16px',
  background: '#1f2937',
  color: 'white',
  border: 'none',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 500,
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: '10px 16px',
  background: 'white',
  color: '#1f2937',
  border: '1px solid #d1d5db',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
};

const successStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 600,
  color: '#166534',
};

const errorStyle: React.CSSProperties = {
  color: '#b91c1c',
  fontSize: 13,
  padding: 12,
  background: '#fef2f2',
  border: '1px solid #fecaca',
  borderRadius: 6,
  marginBottom: 16,
};
