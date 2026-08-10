"use client"

// The four states every section on the Coaching Hub goes through: loading, a
// load error with a retry, nothing to show, and content.
//
// WHY THIS EXISTS. Required Actions, My Plan and Shared documents each carried
// their own copy of the same block — roughly sixty lines of identical structure
// with the wording changed. Three copies of an error banner is three places for
// the error banner to drift, and the dark-theme conversion would have meant
// re-styling the same thing three times.
//
// It is local to the Coaching Hub rather than shared product-wide. The
// converted screens each solved this differently already (Profile has an inline
// error, the tracker a strip, the contact record a retry), and unifying those is
// a bigger question than this page. Three uses in one directory is a component;
// it is not yet a primitive.
//
// STATE ORDER IS LOAD-BEARING. Error beats loading, and empty beats content, so
// a section that fails mid-refresh shows the failure rather than a spinner that
// will never resolve.

import { LIGHT as S, action as actionStyle } from "../../../lib/theme/surfaces"

export function SectionState({
  loading,
  error,
  isEmpty,
  emptyText,
  onRetry,
  children,
}: {
  loading: boolean
  error: string | null
  isEmpty: boolean
  /** Sentence shown when there is nothing yet. Section-specific, always. */
  emptyText: string
  onRetry: () => void
  children: React.ReactNode
}) {
  if (error) {
    return (
      <div data-testid="section-error">
        <div
          style={{
            fontSize: 14, color: S.meaning.error.ink, background: S.meaning.error.fill,
            border: `1px solid ${S.meaning.error.accent}`, borderRadius: 12, padding: "12px 14px",
          }}
        >
          {error}
        </div>
        {/* Outline tier, not filled. Retrying is available rather than urgent,
            and a failed section should not put the loudest button on the page
            next to the thing that just went wrong. */}
        <button
          type="button"
          onClick={onRetry}
          style={{
            ...actionStyle(S, "optional"), marginTop: 12, padding: "10px 18px",
            borderRadius: 10, fontSize: 14, fontFamily: "inherit",
          }}
        >
          Retry
        </button>
      </div>
    )
  }

  if (loading) {
    return (
      <p data-testid="section-loading" style={{ fontSize: 15, color: S.text.muted, margin: 0 }}>
        Loading…
      </p>
    )
  }

  if (isEmpty) {
    return (
      <p
        data-testid="section-empty"
        style={{ fontSize: 15, color: S.text.muted, margin: 0, lineHeight: 1.5 }}
      >
        {emptyText}
      </p>
    )
  }

  return <>{children}</>
}
