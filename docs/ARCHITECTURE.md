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



Trial (Isolated System)



POST /api/jobfit-intake

POST /api/jobfit-run-trial



Trial users use:



jobfit\_users



jobfit\_profiles



Trial is NOT connected to client\_profiles.



Trial users receive 3 credits.



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



credits\_remaining



jobfit\_profiles



unique user\_id



Trial runs NOT written to full-access run tables.



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



C:\\Users\\perig\\wrnsignal-api\\app\\api\\jobfit-intake\\route.ts

C:\\Users\\perig\\wrnsignal-api\\app\\api\\jobfit-run-trial\\route.ts



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

