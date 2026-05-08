# Dev password auth — build summary

**Date:** 2026-05-08
**Scope:** Add email + password sign-in as a parallel auth path to magic link, gated to dev only. Fix the magic-link redirect to land coaches on `/dashboard/coach` regardless of `profile_complete`.

## Status

- ✅ Phase 1 (discovery) — done & approved
- ✅ Phase 2 (build) — done
- 🟡 Phase 3 (verification) — server-side checks pass; runtime browser verification is yours after running the seed script

## What changed

### `scripts/seed-dev-fixture.ts`
- Added `FIXTURE_PASSWORD = "dev-test-1234"` constant
- All 4 fixture auth users (coach + Alex + Brooke + Casey) get the password set on `admin.createUser`
- Coach idempotent path uses `admin.updateUserById` to **reset** the password on every re-seed (so re-runs always land on the known value)
- Final banner now reads:
  ```
  ✓ Fixture seeded. All fixture users have password: dev-test-1234
    Sign in to dev as <COACH_EMAIL> via magic link OR password to test.
    Password sign-in requires NEXT_PUBLIC_DEV_AUTH=true in dev env.
  ```
- Header docs updated to call out the fixture password and the env-var gate

### `app/dashboard/layout.tsx` (sign-in form)
- New state: `password`, `passwordSubmitting`
- New computed flag: `showDevAuth = process.env.NEXT_PUBLIC_DEV_AUTH === "true"`
- New handler: `signInWithPassword()` — calls `supabase.auth.signInWithPassword`, fetches `/api/profile` for `is_coach` + `profile_complete`, then `window.location.replace()` to the right path
- UI changes (only when `showDevAuth` is true):
  - Password input below email (placeholder: `dev-test-1234`)
  - "Sign in with password" button below "Send magic link" (vertical stack, magic-link first)
  - Both buttons disabled while either is in flight
- Magic-link path **unchanged** — same fetch to `/api/auth/send-link`, same form submit, same `linkSent` panel

### `app/api/auth/send-link/route.ts`
- **No code change** — the `is_coach`-first redirect logic was already in place from Sprint 2 (commit `2c6bc563`)
- Updated the stale header comment that still described the pre-Sprint-2 behavior

### `.env.development.local`
- Appended `NEXT_PUBLIC_DEV_AUTH=true`
- **NOT** added to `.env.local` — production deploys use only `.env.local`, so the env var is `undefined` in prod and the password UI never renders

## Redirect decision (both auth paths use this same priority)

```ts
is_coach          → /dashboard/coach
profile_complete  → /dashboard/tracker
else              → /dashboard
```

is_coach is checked first regardless of profile_complete. Implemented in:
- `app/api/auth/send-link/route.ts` (server, magic-link `emailRedirectTo`) — already in place from Sprint 2
- `app/dashboard/layout.tsx` (client, post-`signInWithPassword`) — added in this build

## Discovery findings

- **Dev project email auth is already enabled** (probed `/auth/v1/settings`: `external.email: true`). No Supabase Dashboard toggle needed.
- `signInWithPassword` is not used anywhere else in the codebase today — fresh addition, no conflicts.
- `mailer_autoconfirm: false` is fine since `admin.createUser` uses `email_confirm: true`.

## Verification — what I ran

- ✅ `npx tsc --noEmit` — clean
- ✅ `npm run build` — clean

## Verification — your action (after running the seed)

1. **Run the seed script** with your coach email:
   ```bash
   COACH_EMAIL=<your-email> \
     SUPABASE_URL=https://zydrqckpwidipwbhrfgd.supabase.co \
     SUPABASE_SERVICE_ROLE_KEY=<dev_service_role_key> \
     npx tsx scripts/seed-dev-fixture.ts --confirm
   ```

2. **Browser scenarios** (run dev server with `npm run dev` so `NEXT_PUBLIC_DEV_AUTH=true` is loaded):
   - [ ] Visit `/dashboard` → see sign-in form with email + password fields + two stacked buttons
   - [ ] Sign in as coach (your email + `dev-test-1234`) → lands on `/dashboard/coach`
   - [ ] Sign out, sign in as Alex (`alex+test@example.com` + `dev-test-1234`) → lands on `/dashboard/tracker` (Alex has profile_complete=true, is_coach=false)
   - [ ] Sign out, request a fresh magic link as the coach → email arrives, click link → lands on `/dashboard/coach`
   - [ ] Try password sign-in with wrong password → see error, no redirect
   - [ ] Try empty password (just email) + magic link button → magic link sends as before

3. **Production-like verification** (no `NEXT_PUBLIC_DEV_AUTH`):
   - [ ] Either `npm run build && npm run start`, OR check the deployed prod URL — verify the password input + "Sign in with password" button are NOT rendered, only the email + magic-link button

## Open questions / known issues

1. **The reported "coach lands on /dashboard/tracker" bug** — the server-side fix has been live since Sprint 2 (commit `2c6bc563` deployed `wrnsignal-mnihylb85`). If you're still seeing wrong redirects on freshly-sent magic links, that's a separate diagnostic that's NOT addressed here. Most likely cause: a stale magic-link clicked from before Sprint 2 deployed (the redirect URL is baked in at send time).

2. **Redirect to `/dashboard` for incomplete profiles** — when neither `is_coach` nor `profile_complete` is true, both paths land on `/dashboard` (Overview). This is by design — first-time users go to Overview to complete their profile.

3. **`NEXT_PUBLIC_*` vars are baked into client bundles at build time** — meaning the password UI's visibility is fixed at build time. To toggle in prod, you'd need to redeploy. For dev, this is fine since dev is running `npm run dev` which reads env on each request.

## Not committed

Per your instruction. Awaiting your verification before commit.

## Files touched

```
MODIFIED
  app/api/auth/send-link/route.ts            (comment-only)
  app/dashboard/layout.tsx                   (password UI + handler + state)
  scripts/seed-dev-fixture.ts                (password on createUser/updateUser)
  .env.development.local                     (NEXT_PUBLIC_DEV_AUTH=true appended)

NEW
  docs/dev-password-auth-build.md            (this file)
```
