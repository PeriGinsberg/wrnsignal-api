/**
 * DEV-ONLY environment guard.
 *
 * Used to fence dev-only tooling (currently: jobfit_feedback /
 * positioning_feedback widgets and their API routes) so it cannot
 * render or execute against prod Supabase.
 *
 * The check ties to the Supabase project ref in the public env var,
 * NOT to VERCEL_ENV. Rationale: the actual source of truth for
 * "is this dev" is the database the app is pointed at. If a deploy
 * misconfigures and points prod-Vercel at dev-Supabase, the widget
 * appearing is the smaller problem. If dev-Vercel ever gets pointed
 * at prod-Supabase, the widget should DISAPPEAR — failsafe direction.
 *
 * If you are reading this because you want to remove or weaken the
 * guard: STOP. The guard exists because dev-only feedback rows
 * carry tester identity + resume_text + JD text and the prod schema
 * has no table to receive them anyway (migration was marked ❌ never
 * in the foundation runlog). Re-shipping this widget to prod requires
 * a full redesign — see the migration file header for what changes.
 */

const DEV_SUPABASE_PROJECT_REF = 'zydrqckpwidipwbhrfgd';

export function isDevEnvironment(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  return url.includes(DEV_SUPABASE_PROJECT_REF);
}

/**
 * Throws if called outside the dev environment. Use as the first line
 * of any API route handler that should never execute against prod.
 *
 * @param callsite Short identifier for the calling code path; surfaces
 *   in the error message so server logs are grep-able.
 */
export function assertDevEnvironment(callsite: string): void {
  if (!isDevEnvironment()) {
    throw new Error(
      `[devOnly] ${callsite} called in non-dev environment. ` +
      `This code path is dev-only tooling. If you're seeing this in prod, ` +
      `something has bypassed the route + frontend guards. ` +
      `See lib/devOnly.ts and the foundation runlog (search "❌ never").`
    );
  }
}
