# Attribution Testing Runbook

> **Companion doc:** `ATTRIBUTION_ARCHITECTURE.md` — design rationale, schema reference, non-goals.
> This doc is for operators. It tells you *did it work* and *what to do when it didn't*.

---

## Pre-launch checklist

Run this once before the first real paid traffic hits the site. Every item must be checked.

### Environment variables

13 variables across 4 provider groups. All must be set in Vercel for the `production` environment. Names and source URLs are listed in `.env.example`.

- [ ] **Meta (2):** `META_PIXEL_ID`, `META_CAPI_ACCESS_TOKEN`
- [ ] **TikTok (2):** `TIKTOK_PIXEL_ID`, `TIKTOK_EVENTS_API_TOKEN`
- [ ] **Google Ads (7):** `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_CONVERSION_ACTION_ID`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (optional — MCC only)
- [ ] **GA4 (2):** `GA4_MEASUREMENT_ID`, `GA4_API_SECRET`

Verify in Vercel dashboard → Project → Settings → Environment Variables. Any missing var causes its platform to return `{ status: "skipped" }` silently — functional but ad-platform-blind.

### Database migrations applied

- [ ] `public.purchases` table exists.
- [ ] `public.conversion_log` table exists.

Verify in Supabase SQL editor:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('purchases', 'conversion_log')
ORDER BY table_name;
```

Expect two rows. If not, apply migrations `20260423_purchases_attribution.sql` and `20260423_conversion_log.sql`.

### Framer site republished with the new purchase flow

- [ ] All six Framer code components from Phase 2 pasted into the Framer web editor and the site republished.

**Footgun:** editing the `framer/*.txt` files in this repo does NOT update the live site. Those files are version-controlled reference copies. The Framer web editor is the source of truth for what's live.

Verify by viewing page source on `https://wrnsignal.workforcereadynow.com/` — search for `getAttributionSnapshot`. If absent, the Framer republish never happened.

### Meta custom `Refund` event created

- [ ] Defined in Meta Events Manager: Data Sources → (your Pixel) → Custom Events → Create Event → Name: `Refund`.

Without this, refund events land in CAPI successfully but don't appear in reporting. The first weeks of refund data are lost.

### Platform admin access for Erin

- [ ] Meta Business Manager — **BM Admin** (BM-level, not just ad-account-level, so she can manage Pixel + Datasets)
- [ ] TikTok Business Center — Admin
- [ ] Google Ads — Admin (Standard access) on the ad account matching `GOOGLE_ADS_CUSTOMER_ID`
- [ ] GA4 property — Editor
- [ ] Supabase — read access or SQL query access for monthly health checks

### Optional: Stripe test-mode smoke test

Before first real paid traffic, run the First Real Purchase Runbook using Stripe test mode and card `4242 4242 4242 4242`. Every sync step should work; production ad platforms won't receive these events unless explicitly configured for test mode, which is expected.

---

## First real purchase runbook

### Windows to open (6 tabs)

Keep all six open before initiating the test purchase:

1. **Vercel function logs** — Vercel dashboard → Project → Functions → filter to `/api/webhooks/stripe`
2. **Meta Events Manager Test Events** — Data Sources → (your Pixel) → Test Events
3. **TikTok Events Manager Test Events** — Assets → Events → Test Events
4. **Google Ads Conversions** — Tools → Conversions → (your action) → most recent conversions
5. **GA4 Realtime** — Reports → Realtime (DebugView requires a `debug_mode` parameter we don't send from server-side)
6. **Supabase SQL editor** — `https://supabase.com/dashboard/project/_/sql/new`

### Test URL

```
https://wrnsignal.workforcereadynow.com/signal/jobfit?utm_source=test&utm_medium=paid-social&utm_campaign=smoketest-2026-q2&utm_content=creative-a&utm_term=signal-preview&fbclid=testABC123&ttclid=testDEF456&gclid=testGHI789
```

Open in a fresh incognito window. Complete the full flow with a real card (not a test card — this is the end-to-end production smoke test). Consider a self-refund after verification to recover the $99.

### 30-second verification — synchronous webhook work

- [ ] Vercel logs show `[stripe-webhook] Created new profile for: <email>` (or `Updated existing profile` if repeat)
- [ ] Vercel logs show `[stripe-webhook] Magic link sent to: <email>`
- [ ] Test inbox receives the magic link

```sql
SELECT email, active, purchase_date, stripe_payment_intent_id
FROM client_profiles
WHERE email = '<your-test-email>';
```

Expect: 1 row, `active = true`, `purchase_date` within last minute, `stripe_payment_intent_id` populated.

### 90-second verification — CAPI fan-out

- [ ] `purchases` row exists with full attribution:

```sql
SELECT id, amount_cents, utm_source, utm_campaign, utm_content,
       fbclid, ttclid, gclid, client_ip, client_user_agent
FROM purchases
WHERE email = '<your-test-email>'
ORDER BY created_at DESC
LIMIT 1;
```

Expected: `amount_cents = 9900`, UTMs match the test URL, three click IDs match, `client_ip` and `client_user_agent` populated.

- [ ] 4 `conversion_log` rows exist — one per platform:

```sql
SELECT platform, status, http_status, error_message
FROM conversion_log
WHERE event_id = (
  SELECT stripe_payment_intent_id FROM purchases
  WHERE email = '<your-test-email>'
  ORDER BY created_at DESC LIMIT 1
)
  AND event_type = 'purchase'
ORDER BY platform;
```

Expect 4 rows: `ga4`, `google_ads`, `meta`, `tiktok`. All should be `success` or (if env vars intentionally unset) `skipped`.

- [ ] Meta Test Events shows a `Purchase` event tagged with the hashed email
- [ ] TikTok Test Events shows a `CompletePayment` event
- [ ] Google Ads → Conversions recent column shows the new conversion (may take 3-24 hours to appear in reports, but the API response should have been `success`)
- [ ] GA4 Realtime shows a `purchase` event

### Failure branches — purchase path

1. **No webhook fired at all.**
   Check Stripe dashboard → Developers → Webhooks → your endpoint → Recent deliveries.
   - No delivery recorded → webhook URL misconfigured in Stripe, or `STRIPE_WEBHOOK_SECRET` missing.
   - Delivery recorded as 4xx → inspect the attempted body + Vercel logs.

2. **Profile created but no `purchases` row.**
   Vercel logs should show `[stripe-webhook] purchases insert failed: <error>`. Likely causes: migration not applied in production Supabase; `client_profiles.id` FK type mismatch; `SUPABASE_SERVICE_ROLE_KEY` stale or revoked.

3. **`purchases` row exists but no `conversion_log` rows.**
   `after()` didn't fire. Confirm:
   - Route file has `export const runtime = "nodejs"` (not `edge`).
   - Vercel function timeout is ≥ 10 seconds (the default is fine; check vercel.json).
   - Most common cause: Vercel function cold-start killed the background task. Retry with a second test purchase.

4. **All 4 `conversion_log` rows show `status = 'skipped'`.**
   Env vars missing. `error_message` column will name the missing var. Fix in Vercel → redeploy.

5. **One platform shows `error`, others `success`.**
   Consult the platform-specific troubleshooting tables below.

6. **`purchases.utm_source` is empty even though test URL had `utm_source=test`.**
   Framer republish didn't happen, or sessionStorage write failed. Verify `getAttributionSnapshot` is in page source (see pre-launch).

---

## First real refund runbook

### Initiation paths

Both paths produce identical downstream behavior (both idempotent with each other):

- **User-triggered:** authenticated user POSTs `/api/stripe/refund` (no body). Endpoint validates the 7-day window, calls `stripe.refunds.create`, revokes `client_profiles.active`, writes `purchases.refunded_at`, schedules refund CAPI via `after()`.
- **Admin-triggered:** refund issued from Stripe dashboard. The `charge.refunded` webhook fires, revokes access, writes `purchases.refunded_at`, schedules refund CAPI.

In practice, a user-initiated refund will *also* cause the `charge.refunded` webhook to fire once Stripe processes the refund. **Both paths fire for the same refund.** This is expected.

### Expected writes

- [ ] `client_profiles.active = false` and `client_profiles.refunded_at` is set
- [ ] `purchases.refunded_at` is set (by whichever path fired first; second is a no-op)
- [ ] 4 `conversion_log` rows with `event_type = 'refund'`

```sql
SELECT platform, status, http_status, error_message
FROM conversion_log
WHERE event_id = '<payment_intent_id>'
  AND event_type = 'refund'
ORDER BY platform, created_at;
```

If both paths fired for the same refund, expect up to **8 rows** (4 per path). Duplicates are benign — platforms dedup on `(event_id, event_name)`, Google Ads matches adjustments to conversions via `order_id`, GA4 dedupes on `transaction_id`.

### Platform verification

- [ ] Meta Events Manager Test Events → custom `Refund` event visible
- [ ] TikTok Events Manager Test Events → `Refund` event visible
- [ ] Google Ads → Tools → Conversions → (your action) — the original conversion marked "Retracted" (may take 6-24 hours)
- [ ] GA4 Realtime or DebugView → `refund` event visible

### Failure branches — refund path

1. **Refund issued in Stripe but no `conversion_log` rows with `event_type = 'refund'`.**
   `after()` didn't fire from either path. Same diagnosis as purchase branch 3.

2. **Meta refund events appear in CAPI but not in Meta reports.**
   Custom `Refund` event not created in Events Manager. Create it — retrospective events won't backfill, but future refunds will report correctly.

3. **Google Ads conversion doesn't flip to "Retracted".**
   `order_id` mismatch between original conversion upload and refund adjustment upload. Both should be the Stripe `payment_intent_id`. Inspect `conversion_log.response_payload` for `RESOURCE_NOT_FOUND` or mismatch errors.

4. **Refund `conversion_log` row exists with `status = 'error'`, payload says "CANNOT_RETRACT_CONVERSION_NOT_FOUND".**
   The original Purchase event was never successfully uploaded to Google Ads (e.g., purchase happened before `GOOGLE_ADS_*` env vars were configured). Nothing to retract — acceptable edge case. Ad-platform spend won't auto-correct; manual reconciliation in the Google Ads UI if material.

---

## Platform-specific troubleshooting

### Meta Conversions API

| Symptom | Likely cause | Verify | Fix |
|---|---|---|---|
| Events don't appear in Test Events | Wrong `META_PIXEL_ID` | Compare Vercel env var to Events Manager → Data Sources → Pixel ID | Update env, redeploy |
| Events visible, match quality "Low" | `_fbp` / `_fbc` cookies empty (no Meta Pixel on Framer) | Check `purchases.fbp` / `purchases.fbc` — empty today is expected | Install Meta Pixel on Framer (separate task). fbc is synthesized from fbclid as a partial substitute |
| `Refund` events don't show in reports | Custom event not defined in Events Manager | Events Manager → Custom Events — look for `Refund` | Create event named `Refund` |
| `conversion_log.error_message`: "Invalid OAuth 2.0 Access Token" | `META_CAPI_ACCESS_TOKEN` expired | Events Manager → Settings → CAPI → token info | Regenerate access token, update env, redeploy |
| Every `meta` row shows HTTP 400 | Pixel ID or token malformed | Check `response_payload` column | Verify env values character-by-character |
| Events land but show as "Browser" source | `action_source` field wrong | Should be `"website"` — hardcoded in `meta.ts` | Not a real issue; report field misunderstanding |

### TikTok Events API

| Symptom | Likely cause | Verify | Fix |
|---|---|---|---|
| Events don't appear in Test Events | Wrong `TIKTOK_PIXEL_ID` | Compare Vercel env to TikTok Events Manager → pixel code | Update env |
| HTTP 401 or "Invalid access token" | `TIKTOK_EVENTS_API_TOKEN` expired / revoked | Inspect `conversion_log.response_payload` | Regenerate in Events Manager → Settings → Events API, update env, redeploy |
| `ttclid` missing warnings in TikTok Events Manager | No TikTok Pixel on Framer; `ttp`/`ttclid` empty | Check `purchases.ttp` — empty today is expected | Install TikTok Pixel on Framer (separate task) |
| Match quality "Poor" | `client_ip` format rejected | Check `purchases.client_ip` — should be an IPv4 or IPv6 string | Verify IP extraction chain in `/api/checkout/create-session` |
| Events land but don't attribute to campaigns | No `ttclid` from TikTok ads | Check `purchases.ttclid` for real paid traffic | This is a TikTok limitation for non-in-app users — ttclid only populates when users click TikTok ads in the TikTok app |

### Google Ads API

Most troubleshooting volume lands here due to the OAuth + MCC complexity.

| Symptom | Likely cause | Verify | Fix |
|---|---|---|---|
| `conversion_log` shows `google_ads` as `skipped` | ≥1 of 6 required env vars missing | `error_message` column lists the missing var names | Set missing env in Vercel, redeploy |
| HTTP 401 | Access token exchange failed | `error_message` contains "OAuth token exchange failed" | `GOOGLE_ADS_REFRESH_TOKEN` revoked — re-run OAuth Playground flow, update env |
| HTTP 403, `CUSTOMER_NOT_ENABLED` in payload | Developer token not approved | Google Ads API Center → token status | Wait for approval (24-48h from first request) |
| HTTP 403, `USER_PERMISSION_DENIED` | Missing `GOOGLE_ADS_LOGIN_CUSTOMER_ID` for MCC account | Check if ad account is under an MCC manager | Set `GOOGLE_ADS_LOGIN_CUSTOMER_ID` to the manager's customer ID |
| HTTP 404, `RESOURCE_NOT_FOUND` | Wrong `GOOGLE_ADS_CUSTOMER_ID` or `CONVERSION_ACTION_ID` | `response_payload` names which resource | Verify both in Google Ads UI; customer ID must be no-dashes format |
| HTTP 400, `INVALID_ARGUMENT: Date time format` | Time format regression | Check `formatGoogleAdsTime` helper output | Must be `yyyy-MM-dd HH:mm:ss+00:00` (space separator, colon in offset) |
| Refund succeeds but conversion not retracted | `order_id` mismatch between purchase and refund uploads | Both should be `payment_intent_id` | Verify `event_id` equality in conversion_log for the same PaymentIntent |
| Conversion shows in reports 24h late | Normal attribution window | Google Ads → Conversions → "Recent" column | Wait up to 24h for first appearance in reports |
| `API_VERSION_DEPRECATED` | Pinned version sunset | `response_payload` will call it out | Bump `API_VERSION` constant in `googleAds.ts`; see architecture doc § Version bump cadence |

### GA4 Measurement Protocol

| Symptom | Likely cause | Verify | Fix |
|---|---|---|---|
| Events don't show in Realtime | Wrong `GA4_MEASUREMENT_ID` | Compare env to GA4 Admin → Data Streams → measurement ID | Update env, redeploy |
| HTTP 204 returned but no events visible | Events silently discarded due to format error | MP's 204 doesn't mean accepted — inspect request body in `conversion_log.response_payload` | Check payload structure matches GA4 MP spec |
| DebugView shows nothing | DebugView requires `debug_mode=true` param | We don't send `debug_mode` from server-side | Use Realtime view instead |
| Events visible but not counted as key events | `purchase` not marked as key event | GA4 Admin → Events → mark `purchase` as key event | Takes up to 24h to propagate |
| Revenue column shows 0 | `value` / `currency` missing or wrong type | Inspect `response_payload` for validation warnings | Verify `amount_cents` populated in `purchases` |
| Refund events don't reduce revenue | Different `transaction_id` between purchase and refund | Both should be `payment_intent_id` | Compare conversion_log rows for the same PaymentIntent |

---

## Degradation scenarios

| Failure | Urgency | User-facing impact | Observable signal | Response |
|---|---|---|---|---|
| Single CAPI provider 5xx | P3 | None | `conversion_log.status = 'error'` rows for one platform | Monitor; usually transient. If persistent over 1h, check that platform's status page |
| All 4 CAPI providers 5xx simultaneously | P2 | None to user; Erin's optimization data is gapped | `conversion_log` shows `error` for all 4 platforms across a time window | Check Vercel function logs for network errors; likely Vercel egress or DNS issue, not all 4 platforms down at once |
| Supabase unreachable | P0 | **Purchase flow broken** — no profile, no magic link | Vercel logs show Supabase connection errors; Stripe webhook retries | Supabase status page; if on Pro tier and down, contact support. Stripe will retry for 3 days so users may recover once Supabase is back |
| Webhook code deploy regression | P0 | Users complete purchase but don't get magic link; customer support tickets within minutes | Vercel deployment page shows recent deploy; Stripe dashboard shows webhook delivery failures | Rollback via Vercel dashboard → Deployments → Promote previous |
| `GOOGLE_ADS_REFRESH_TOKEN` revoked | P1 | Google Ads optimization silently degraded | `conversion_log.status = 'error'` for `google_ads` with "OAuth token exchange failed" | Re-run OAuth Playground flow, update env, redeploy. No retroactive backfill of missed events |
| `META_CAPI_ACCESS_TOKEN` expired | P1 | Meta optimization silently degraded | `conversion_log.status = 'error'` for `meta` with "Invalid OAuth 2.0 Access Token" | Regenerate token in Events Manager → Settings → CAPI, update env, redeploy |
| Vercel function timeout on webhook | P2 | Occasional CAPI events dropped (after() background task killed before it completed) | Sparse missing `conversion_log` rows; purchases rows exist without matching fan-out | Bump function timeout in vercel.json (default 10s — normally enough for 4 parallel 3s calls, but tail latency can spike) |
| Framer site shows old (pre-attribution) code | P1 | New UTMs / click IDs not captured; purchases rows have empty attribution fields | `purchases` rows have `utm_source = ''` etc. for real paid traffic | Republish Framer site — `.txt` file edits in the repo don't auto-deploy. See architecture doc § Layer 1 |
| `.next/types/validator.ts` staleness (deploy-time only) | P3 | Vercel build fails | Vercel build logs show TS error about missing route module | Usually clears on a re-trigger (cache invalidation). If persistent, remove stale .next cache via Vercel → Settings → Clear Cache |

---

## Monthly health check

Run on the first Monday of each month. Copy-paste each query into the Supabase SQL editor.

### 1. CAPI success rate (last 30 days)

```sql
SELECT platform,
       status,
       COUNT(*) AS rows,
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY platform), 1) AS pct_within_platform
FROM conversion_log
WHERE created_at > now() - interval '30 days'
GROUP BY platform, status
ORDER BY platform, status;
```

**Target:** `success` ≥ 98% per platform. Any platform with ≥ 2% `error` warrants checking the platform-specific troubleshooting table.

### 2. Skip-rate sanity check

```sql
SELECT platform, COUNT(*) AS skipped
FROM conversion_log
WHERE status = 'skipped'
  AND created_at > now() - interval '30 days'
GROUP BY platform
ORDER BY skipped DESC;
```

**Target:** 0 rows. Any rows mean that platform's env vars are still missing. Cross-reference `.env.example` § Attribution section.

### 3. Orphaned purchases (CAPI didn't fire)

```sql
SELECT p.id, p.email, p.stripe_payment_intent_id, p.created_at
FROM purchases p
LEFT JOIN conversion_log c
       ON c.purchase_id = p.id AND c.event_type = 'purchase'
WHERE c.id IS NULL
  AND p.created_at > now() - interval '30 days'
  AND p.created_at < now() - interval '5 minutes'  -- exclude just-inserted
ORDER BY p.created_at DESC;
```

**Target:** 0 rows. Each row represents a purchase where `after()` failed to fire CAPI fan-out — likely a Vercel function cold-start kill. Investigate Vercel function logs for the timestamp.

### 4. `response_payload` column size

```sql
SELECT
  pg_size_pretty(AVG(pg_column_size(response_payload))::bigint) AS avg_size,
  pg_size_pretty(MAX(pg_column_size(response_payload))::bigint) AS max_size,
  pg_size_pretty(SUM(pg_column_size(response_payload))::bigint) AS total_size_30d
FROM conversion_log
WHERE response_payload IS NOT NULL
  AND created_at > now() - interval '30 days';
```

**Thresholds** (from architecture Month 6 review):
- avg > 4KB → start trimming payloads in `logConversion()`
- max > 64KB → urgent trim; one bad error payload can bloat a row

### 5. Recent errors grouped

```sql
SELECT platform, error_message, COUNT(*) AS occurrences, MAX(created_at) AS last_seen
FROM conversion_log
WHERE status = 'error'
  AND created_at > now() - interval '30 days'
GROUP BY platform, error_message
ORDER BY occurrences DESC
LIMIT 20;
```

Prioritize by `occurrences`. Most entries should map to a row in the platform-specific troubleshooting tables above. Novel errors warrant investigation.

### 6. Refund path health

```sql
SELECT event_type,
       COUNT(*) AS attempts,
       COUNT(DISTINCT purchase_id) AS unique_purchases
FROM conversion_log
WHERE event_type = 'refund'
  AND created_at > now() - interval '30 days';
```

`attempts` should be `unique_purchases × 4` if only one path fired per refund, or up to `unique_purchases × 8` if both paths fired for each (normal when user-triggered refunds are common). A ratio below 4 means some providers are silently missing refund events — investigate via query 5.

### 7. Google Ads API version reminder

Pinned at `v23` in `app/api/_lib/conversions/googleAds.ts`. Released 2026-01-28. Typical Google Ads API support window is ~12 months.

Release notes: `https://developers.google.com/google-ads/api/docs/release-notes`

Bump the `API_VERSION` constant when v23 sunset is announced — typically flagged around Oct-Dec 2026.
