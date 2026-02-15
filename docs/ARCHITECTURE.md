SIGNAL Source of Truth Handoff (Paste Into New Thread)

1\) What SIGNAL is



SIGNAL is a job-search decision system for college students.

Front end is a Framer site.

Back end is a Next.js API on Vercel.

Auth is Supabase magic link only (no passwords for full-access users).



2\) Environments



Production



Live site: https://wrnsignal.workforcereadynow.com



API base: https://wrnsignal-api.vercel.app



Upgrade URL: https://www.workforcereadynow.com/signal/home



Supabase project id: ejhnokcnahauvrcbcmic



Dev



Dev site: https://genuine-times-909123.framer.app/



API base: https://wrnsignal-api-staging.vercel.app



Supabase dev URL: https://zydrqckpwidipwbhrfgd.supabase.co



Magic link redirect for dev:



const DEV\_SITE\_URL = "https://genuine-times-909123.framer.app"

function getMagicLinkRedirect() { return DEV\_SITE\_URL + "/" }



3\) Core API routes and who can call them



Authenticated full-access (Bearer token via Supabase)



POST /api/jobfit



POST /api/positioning



POST /api/coverletter



POST /api/networking



POST /api/profile-risk-overrides



Trial flow (separate, isolated today)



POST /api/jobfit-intake (public, no auth, intake form writes to trial tables)



POST /api/jobfit-run-trial (trial user runs JobFit using their trial profile, decrements credits)



Important: today trial users and full-access users are isolated. Future upgrade path may map trial info into client\_profiles, but not now.



4\) CORS (single source of truth)



All routes must use the shared CORS helpers:



File: app/api/\_lib/cors.ts



Use:



export async function OPTIONS(req) { return corsOptionsResponse(req.headers.get("origin")) }



Return responses via withCorsJson(req, data, status)



Do NOT hardcode origin regex/patterns inside route files.



CORS allows:



https://wrnsignal.workforcereadynow.com



https://www.workforcereadynow.com



https://workforcereadynow.com



\*.framer.app



\*.framercanvas.com



localhost + 127.0.0.1



5\) Auth + profile ownership (single source of truth)



Full-access routes must use:



File: app/api/\_lib/authProfile.ts (not route.ts)



Function: getAuthedProfileText(req)



This does:



validates bearer token



ensures exactly one client\_profiles row per user\_id



attaches email-only profile row (if exists) to user\_id safely



Client never writes directly to client\_profiles.



6\) Deterministic caching pattern (must be consistent)



For modules that cache results (JobFit, Positioning, Networking, Coverletter):



Build deterministic fingerprint payload:



job text



profile id + profile text



prompt version constant



model id constant



any pinned deterministic logic params (example: keyword logic)



Hash canonicalized normalized JSON with sha256



Query existing run table by:



client\_profile\_id



fingerprint\_hash



If exists: return cached result with { reused: true }



If not: run OpenAI, store result, return with { reused: false }



Prefer upsert with onConflict: "client\_profile\_id,fingerprint\_hash" to avoid double-click race conditions.



7\) Database tables



Full-access



client\_profiles (unique user\_id and unique email)



jobfit\_runs (unique client\_profile\_id + fingerprint\_hash)



positioning\_runs (unique client\_profile\_id + fingerprint\_hash)



coverletter\_runs (unique client\_profile\_id + fingerprint\_hash)



networking\_runs (unique client\_profile\_id + fingerprint\_hash)



Trial



jobfit\_users (unique email, credits\_remaining)



jobfit\_profiles (unique user\_id, stores profile\_text)



Trial runs are not written into full-access run tables today.



Trial credits: new trial user gets 3 total credits.



8\) Local file paths (Windows)



C:\\Users\\perig\\wrnsignal-api\\app\\api\\jobfit\\route.ts



C:\\Users\\perig\\wrnsignal-api\\app\\api\\positioning\\route.ts



C:\\Users\\perig\\wrnsignal-api\\app\\api\\coverletter\\route.ts



C:\\Users\\perig\\wrnsignal-api\\app\\api\\networking\\route.ts



C:\\Users\\perig\\wrnsignal-api\\app\\api\\jobfit-intake\\route.ts



C:\\Users\\perig\\wrnsignal-api\\app\\api\\jobfit-run-trial\\route.ts



C:\\Users\\perig\\wrnsignal-api\\app\\api\\profile-risk-overrides\\route.ts



C:\\Users\\perig\\wrnsignal-api\\app\\api\\\_lib\\authProfile.ts



C:\\Users\\perig\\wrnsignal-api\\app\\api\\\_lib\\cors.ts



C:\\Users\\perig\\wrnsignal-api\\app\\api\\\_lib\\jobfitEvaluator.ts



9\) Current known gotchas



If you see Failed to fetch plus CORS preflight missing Access-Control-Allow-Origin, it means the route is not using \_lib/cors.ts correctly or OPTIONS isn’t returning the right headers for the requesting origin (often \*.framercanvas.com).



Don’t inline origin logic inside route files. Always use \_lib/cors.ts.

