SIGNAL Source of Truth Handoff



(Locked Architecture – Paste Into New Thread)



Thread Starters (Paste First)



“This is the locked SIGNAL architecture. Treat it as source of truth.”



“Ask me only for deltas or missing pieces.”



“Do not assume missing files; confirm via this doc.”



1\) What SIGNAL Is



SIGNAL is a job-search decision system for college students.



Architecture:



Front end: Framer



Back end: Next.js API deployed on Vercel



Auth: Supabase (magic link only for full-access users)



Database: Supabase Postgres



Full-access users authenticate via Supabase magic link.

Trial users are isolated in a separate flow.



2\) Environments

Production



Live site:

https://wrnsignal.workforcereadynow.com



API base:

https://wrnsignal-api.vercel.app



Upgrade URL:

https://www.workforcereadynow.com/signal/home



Supabase project id:

ejhnokcnahauvrcbcmic



Magic link redirect (prod):

https://wrnsignal.workforcereadynow.com/signal/intake



Dev



Dev site:

https://genuine-times-909123.framer.app/



API base:

https://wrnsignal-api-staging.vercel.app



Supabase dev URL:

https://zydrqckpwidipwbhrfgd.supabase.co



Magic link redirect (dev):



const DEV\_SITE\_URL = "https://genuine-times-909123.framer.app"

function getMagicLinkRedirect() {

&nbsp; return DEV\_SITE\_URL + "/signal/intake"

}



3\) Access Model (Seat-Based Full Access)



Full access is seat-based.



Flow:



Buyer completes checkout.



Backend creates a row in signal\_seats.



A claim\_token (raw) is generated.



Only claim\_token\_hash (sha256) is stored in DB.



User receives a claim link:

/start?claim=RAW\_TOKEN



User verifies seat via /api/seat-verify.



System sends Supabase magic link via /api/send-magic-link.



Supabase redirects to /signal/intake.



Intake form writes to client\_profiles.



User is redirected to /signal/jobfit.



Seats expire and are single-use.



4\) Core API Routes

Seat / Auth



POST /api/seat-create

Creates a new seat. Stores hashed claim token.



POST /api/seat-verify

Validates claim token + email.

Returns { ok, verified, seat\_id }.



POST /api/send-magic-link

Re-verifies seat server-side.

Uses Supabase signInWithOtp() with redirect.

Updates seat status to "sent".



Full-Access Authenticated Routes (Bearer Required)



POST /api/profile-intake

Creates or updates client\_profiles row for authenticated user.



POST /api/jobfit

POST /api/positioning

POST /api/coverletter

POST /api/networking

POST /api/profile-risk-overrides



All require:



Authorization: Bearer <supabase\_access\_token>



Trial (Isolated System) — Free Job Analysis



POST /api/jobfit-run-trial



Single endpoint. Public, no auth. One-shot real JobFit run for free-trial users.



Request shape:



{ email, resume\_text, job\_description, session\_id?, utm\_\* }



Email is captured upstream on the landing page and passed through as a URL param

into the trial UI; the request body carries it explicitly. Resume text and JD body

are pasted by the user.



Flow:



validate inputs → check jobfit\_users by email → infer profileOverrides

from the resume via Haiku (inferProfileOverridesFromResume) → run runJobFit()

with the same engine and overrides shape as the paid path → V5 bullets →

cache the result in jobfit\_trial\_runs → decrement credits → return result

with a `locks` block (cover\_letter, networking, resume\_positioning, tracker,

run\_another\_job) plus an `upgrade` block.



Run-once enforcement:



New users are inserted with credits\_remaining = 1 specifically by this route

(the table default of 3 is preserved for any non-redesign caller).

Returning users with credits = 0 get the cached result (same JD) plus

`locked: true`, OR `status: "out\_of\_credits"` with `result: null` (different JD).



Caching:



jobfit\_trial\_runs(email, jd\_hash, result\_json, created\_at)

with UNIQUE (email, jd\_hash). Indefinite TTL.



Trial users use:



jobfit\_users



jobfit\_profiles



jobfit\_trial\_runs



Trial is NOT connected to client\_profiles.



Frozen / sunset endpoints (return 410 Gone):



POST /api/jobfit-intake — was the legacy multi-credit trial intake form.

Replaced by the one-shot resume+JD flow above. File frozen, not deleted.



POST /api/jobfit-trial-lookup — was the existence-check the dashboard used

to flip a user into accessMode === "jobfit\_only". Sunset along with that

access mode. File frozen, not deleted.



POST /api/job-analysis — pre-redesign market-intelligence-only free tool.

Frozen pending Framer page rewrite. File frozen, not deleted; will be

removed after the new Framer trial page replaces the legacy one.



Removed concepts (do not recreate):



accessMode === "jobfit\_only" — removed from the Framer dashboard. Access is

now binary: authed (full) or signed-out. The dashboard no longer has a

trial-tier credit-metered mode.



Legacy 3-credit free trial with stored intake fields — replaced by the

one-shot resume + JD flow above. Existing rows in jobfit\_users and

jobfit\_profiles from the old flow are intentionally left in place; no UI

path reaches them.



localStorage keys jobfit\_unlocked and jobfit\_email — no longer set by any

active code. Defensive cleanup in the dashboard's logout() sweeps any

stragglers from returning users' browsers.



5\) CORS (Single Source of Truth)



All routes MUST use:



File:



app/api/\_lib/cors.ts





Pattern:



export async function OPTIONS(req) {

&nbsp; return corsOptionsResponse(req.headers.get("origin"))

}





Return responses using:



withCorsJson(req, data, status)





Allowed origins:



https://wrnsignal.workforcereadynow.com



https://www.workforcereadynow.com



https://workforcereadynow.com



\*.framer.app



\*.framercanvas.com



localhost



127.0.0.1



Never inline origin logic inside route files.



6\) Auth + Profile Ownership (Single Source of Truth)



File:



app/api/\_lib/authProfile.ts





Function:



getAuthedProfileText(req)





Responsibilities:



Validates Supabase bearer token



Extracts user\_id



Ensures exactly one client\_profiles row per user\_id



Safely attaches email-only profile to user\_id if needed



Prevents client from directly writing to client\_profiles



Client never writes directly to client\_profiles.



7\) Full-Access Intake (3-Screen Wizard)



Route:

/signal/intake



Component:



Auth gated



Requires Supabase session



On submit:



Synthesizes canonical profile\_text



Sends POST /api/profile-intake



Redirects to /signal/jobfit



Redirect path after intake:



/signal/jobfit



7\.5\) JobFit Scoring Pipeline



The JobFit engine is fully deterministic except for one LLM step (V5 bullet rendering).

Same pipeline runs for the paid path and the free-trial path; the only difference is

how profileOverrides are sourced.



Pipeline:



extract.ts → scoring.ts → decision.ts → jobfitEvaluator.ts (orchestrator) →

bulletGeneratorV5.ts (V5 LLM bullet renderer; Claude Haiku)



Inputs into jobfitEvaluator.runJobFit():



profileText (string), jobText (string), profileOverrides? (Partial structured signals),

userJobTitle?, userCompanyName?



Where profileOverrides comes from:



- Paid flow: mapClientProfileToOverrides() in app/api/\_lib/jobfitProfileAdapter.ts —

reads from the user's structured intake form fields stored on client\_profiles.



- Trial flow: inferProfileOverridesFromResume() in

app/api/\_lib/inferProfileOverridesFromResume.ts — Haiku pre-pass that derives the

same structured signals (target families, role targets, job-type preference,

grad year, location preference, tools) directly from the pasted resume.

Fails open: returns {} on any error so runJobFit falls back to its heuristic

detectors. Trial users do not have an intake form, so this pre-pass exists

specifically to bridge the precision gap.



Both paths converge on the same engine and the same V5 renderer. Any change to

extract / scoring / decision / V5 affects both.



8\) Deterministic Caching Pattern (MANDATORY)



Applies to:



JobFit



Positioning



Cover Letter



Networking



Fingerprint payload includes:



job text



profile id



profile text



prompt version constant



model id constant



pinned deterministic params



Steps:



Normalize



JSON stringify canonicalized payload



SHA256 hash



Query run table by:



client\_profile\_id



fingerprint\_hash



If exists:



return cached result



{ reused: true }



If not:



run evaluator



insert result



return { reused: false }



Prefer:



upsert with onConflict: "client\_profile\_id,fingerprint\_hash"





To avoid race conditions.



9\) Database Tables

Full Access



client\_profiles



unique user\_id



unique email



jobfit\_runs



unique (client\_profile\_id, fingerprint\_hash)



positioning\_runs

coverletter\_runs

networking\_runs



Each has unique (client\_profile\_id, fingerprint\_hash)



signal\_seats



claim\_token\_hash



seat\_email



intended\_user\_name



status



expires\_at



used\_at



Trial



jobfit\_users



unique email



credits\_remaining (table default = 3; new redesigned-flow inserts use 1)



jobfit\_profiles



unique user\_id



jobfit\_trial\_runs (added 2026-05-03)



unique (email, jd\_hash)



one-shot result cache; lookups by (email, jd\_hash) feed the cached-result

response on a returning user.



Trial runs NOT written to full-access run tables.



Legacy jobfit\_users / jobfit\_profiles rows from the pre-redesign flow are

intentionally left in place. They are not migrated, not deleted, and no

active UI path reaches them.



10\) Supabase Auth Notes (Critical)



Auth mode: Magic link only.



PKCE is enabled.



When Supabase redirects with:



?code=...





Frontend must call:



supabase.auth.exchangeCodeForSession(code)





BEFORE:



supabase.auth.getSession()





If not, the session will not initialize.



Expired links produce:



error=access\_denied

error\_code=otp\_expired





Supabase email rate limits can produce:



email rate limit exceeded



11\) Local File Paths (Windows)



C:\\Users\\perig\\wrnsignal-api\\app\\api\\seat-create\\route.ts

C:\\Users\\perig\\wrnsignal-api\\app\\api\\seat-verify\\route.ts

C:\\Users\\perig\\wrnsignal-api\\app\\api\\send-magic-link\\route.ts



C:\\Users\\perig\\wrnsignal-api\\app\\api\\profile-intake\\route.ts



C:\\Users\\perig\\wrnsignal-api\\app\\api\\jobfit\\route.ts

C:\\Users\\perig\\wrnsignal-api\\app\\api\\positioning\\route.ts

C:\\Users\\perig\\wrnsignal-api\\app\\api\\coverletter\\route.ts

C:\\Users\\perig\\wrnsignal-api\\app\\api\\networking\\route.ts



C:\\Users\\perig\\wrnsignal-api\\app\\api\\jobfit-run-trial\\route.ts

C:\\Users\\perig\\wrnsignal-api\\app\\api\\\_lib\\inferProfileOverridesFromResume.ts



Frozen (return 410):



C:\\Users\\perig\\wrnsignal-api\\app\\api\\jobfit-intake\\route.ts

C:\\Users\\perig\\wrnsignal-api\\app\\api\\jobfit-trial-lookup\\route.ts

C:\\Users\\perig\\wrnsignal-api\\app\\api\\job-analysis\\route.ts



C:\\Users\\perig\\wrnsignal-api\\app\\api\\profile-risk-overrides\\route.ts



C:\\Users\\perig\\wrnsignal-api\\app\\api\_lib\\authProfile.ts

C:\\Users\\perig\\wrnsignal-api\\app\\api\_lib\\cors.ts

C:\\Users\\perig\\wrnsignal-api\\app\\api\_lib\\jobfitEvaluator.ts



12\) Current Known Gotchas



If you see:



Failed to fetch





And CORS preflight error:



No 'Access-Control-Allow-Origin'





It means:



Route is not using \_lib/cors.ts



OPTIONS handler missing



Origin not matched (often \*.framercanvas.com)



Do not inline CORS logic.



13\) Critical Separation Rules



Trial and full-access are isolated.



Magic link flow is seat-based.



Only server writes to:



client\_profiles



run tables



signal\_seats



Client never:



touches run tables



writes to client\_profiles directly



manipulates seat status

