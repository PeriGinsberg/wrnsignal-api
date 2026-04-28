# SIGNAL Development Workflow

This document describes how we build, test, and deploy SIGNAL. It's the rules of the road for working on this codebase. Read it before making your first change.

The product spans four environments that have to stay in sync: a code repository, a Vercel deployment, a Supabase database, and a Framer marketing site. Changes ripple across all four, and getting the order wrong creates outages or data loss. The patterns below exist to prevent that.

## The mental model

We have two parallel environments: dev and prod. Each has four pieces:

| Piece | dev | prod |
|---|---|---|
| Git branch | dev | main |
| Vercel deploy | staging URL | production URL |
| Supabase project | SIGNAL DEV (zydrqckpwidipwbhrfgd) | WRNSignal (ejhnokcnahauvrcbcmic) |
| Framer project | dev project (genuine-times-909123.framer.app) | prod project (custom domain) |

Code flows in one direction: dev → prod. Never the other way. Anything you do in prod that doesn't first pass through dev is technical debt that will hurt later.

The goal of dev is to be a place where you can break things without consequences. If dev isn't broken sometimes, you're not using it.

## Daily workflow: the happy path

A typical change goes like this:

1. **Start on the dev branch.** `git checkout dev && git pull` so you start from latest.
2. **Make your code changes.** Commit to dev. Push to GitHub.
3. **Vercel auto-deploys the dev branch to the staging URL.** Wait for the deploy to finish (you'll get a notification or you can watch it in the Vercel dashboard).
4. **Test against staging.** Open the staging URL. Try the feature you changed and a couple of unrelated flows to make sure you didn't break something else. The staging URL is connected to SIGNAL DEV Supabase, so any data you create there lands in dev.
5. **If it works, promote to prod.** Open a pull request from dev to main on GitHub. Even with one author, the PR gives you a moment of "do I really want to ship this." Merge it.
6. **Vercel auto-deploys main to production.** Watch the deploy. Visit the production URL. Verify the feature works.

That's the happy path. Most changes follow exactly this pattern.

### What the PR step is for

A PR with one author seems silly. It exists for two reasons:

- The diff view forces you to look at every file you changed. You will catch things — debug logs left in, hardcoded test values, an env var renamed in one place but not another.
- It creates a permanent record of every prod release. Six months from now when you're trying to figure out when a bug was introduced, the merge commits on main are your release history.

Don't skip it.

## Schema changes (the dangerous kind)

When a code change requires a database change — new column, new table, new index, modified constraint — the workflow has an extra layer because schema changes can be destructive.

The order is strict:

1. **Write the SQL for the change.** A `.sql` file in `supabase/migrations/` named with a timestamp prefix. Example: `20260428143022_add_phone_to_client_profiles.sql`. The timestamp is just `YYYYMMDDhhmmss` of when you wrote it — gives migrations a stable order.
2. **Apply it to dev Supabase first.** Open SIGNAL DEV in the Supabase dashboard, SQL Editor, paste the SQL, run.
3. **Verify dev.** Run a `SELECT` or check the Database → Tables view to confirm the change took effect.
4. **Now make your code changes that depend on the new schema.** Commit, push, test on staging. The staging URL hits SIGNAL DEV which now has the new schema, so your code can use it.
5. **Once everything works on staging, repeat steps 2–3 against prod Supabase (WRNSignal).** Same SQL, same dashboard, different project.
6. **Then merge the PR to main.** Vercel deploys the code to prod, which now has the prod schema it expects.

Note the order in step 5–6: schema goes to prod **before** code does. Code that references a column that doesn't exist yet errors immediately. Schema that has a column the code doesn't use yet is harmless.

### Rolling back a schema change

There isn't an easy rollback. If you ship a schema change and it goes wrong:

- For **additive changes** (new column, new table): leave the schema, fix forward in code. The unused column is harmless.
- For **destructive changes** (dropped column, changed type): the data is gone. There's no rollback. This is why destructive schema changes require an extra layer of paranoia — back up data first, do them during low-traffic windows, have a recovery plan.

We don't currently have a formal rollback process. For now, when a destructive schema change is on the table, talk through it with another engineer (or write the plan out for yourself in the PR description) before running it. The future of this is automated migrations with rollback support, but we're not there yet.

## Code changes that affect Framer

The marketing site (everything at the top-of-funnel domain) lives in Framer, not in this repo. There are two Framer projects: dev and prod, each pointed at the matching Supabase. They have to be kept in sync manually.

When a code component on the Framer site needs to change:

1. Open the dev Framer project. Make the edit. Save.
2. The dev Framer site auto-publishes to its custom URL. Test there.
3. When it works, open the prod Framer project and make the same edit. Save. Prod Framer auto-publishes.

The env variables in the code components differ between the two projects (dev → SIGNAL DEV Supabase URL/keys, prod → WRNSignal). **Do not copy code components verbatim between projects** — you'll overwrite the env config and accidentally point one site at the other's database. Make the logic change in both, leave the config alone.

## PowerShell safety: the once-a-week prod problem

You will, occasionally, need to run something against prod Supabase from your local terminal. A one-off query, a manual data fix, an emergency. The risk is mistaking which environment your terminal is connected to and running a destructive command against the wrong one.

The pattern is: make your terminal visibly tell you what it's connected to, every prompt.

### Setup (one time)

Add this to your PowerShell profile. Find your profile path with:

```powershell
$PROFILE
```

If the file doesn't exist, create it:

```powershell
New-Item -Path $PROFILE -Type File -Force
notepad $PROFILE
```

Add this content:

```powershell
# SIGNAL environment safety prompt
function prompt {
    $env_label = ""
    if ($env:SIGNAL_ENV -eq "PROD") {
        $env_label = "[PROD] "
        Write-Host -NoNewline -ForegroundColor White -BackgroundColor Red $env_label
    } elseif ($env:SIGNAL_ENV -eq "DEV") {
        $env_label = "[DEV] "
        Write-Host -NoNewline -ForegroundColor Black -BackgroundColor Green $env_label
    }
    "PS $($executionContext.SessionState.Path.CurrentLocation)$('>' * ($nestedPromptLevel + 1)) "
}

# Helper functions for switching environments
function Use-DevDB {
    $env:SIGNAL_ENV = "DEV"
    Write-Host "Switched to DEV. Set `$env:DEV_DB_URL_PLAIN before running queries." -ForegroundColor Green
}

function Use-ProdDB {
    Write-Host "WARNING: switching to PROD. This is the live customer database." -ForegroundColor Red
    $confirm = Read-Host "Type 'PROD' to confirm"
    if ($confirm -eq "PROD") {
        $env:SIGNAL_ENV = "PROD"
        Write-Host "Switched to PROD." -ForegroundColor Red
    } else {
        Write-Host "Cancelled. Still in $($env:SIGNAL_ENV)." -ForegroundColor Yellow
    }
}

function Clear-DBEnv {
    Remove-Item Env:SIGNAL_ENV -ErrorAction SilentlyContinue
    Remove-Item Env:DEV_DB_URL_PLAIN -ErrorAction SilentlyContinue
    Remove-Item Env:PROD_DB_URL_PLAIN -ErrorAction SilentlyContinue
    Write-Host "Cleared all DB environment variables." -ForegroundColor Yellow
}
```

Save and reload your shell. From now on:

- `Use-DevDB` switches your shell to dev mode. Prompt turns green with `[DEV]`.
- `Use-ProdDB` requires you to type "PROD" to confirm. Prompt turns red with `[PROD]`.
- `Clear-DBEnv` clears everything — run this at end of session.

You won't be able to forget which environment you're in. Every prompt screams it at you.

### Setting the database URL when needed

Once you've called `Use-DevDB` or `Use-ProdDB`, you still need the actual connection string in an env var before running `psql` or `pg_dump`:

```powershell
# Use the file approach for the password (Read-Host has paste issues on some setups)
notepad pw.tmp
# (paste password, save, close)

Add-Type -AssemblyName System.Web
$plainPw = (Get-Content pw.tmp -Raw).Trim()
$encodedPw = [System.Web.HttpUtility]::UrlEncode($plainPw)

# Use the right project ref for whichever environment you're in
if ($env:SIGNAL_ENV -eq "DEV") {
    $env:DEV_DB_URL_PLAIN = "postgresql://postgres.zydrqckpwidipwbhrfgd:$encodedPw@aws-0-us-west-2.pooler.supabase.com:5432/postgres"
} elseif ($env:SIGNAL_ENV -eq "PROD") {
    $env:PROD_DB_URL_PLAIN = "postgresql://postgres.ejhnokcnahauvrcbcmic:$encodedPw@aws-0-us-west-2.pooler.supabase.com:5432/postgres"
}

Remove-Item pw.tmp
$plainPw = $null
$encodedPw = $null
```

Then run your `psql` commands against the appropriate env var.

### Hard rules for prod work

When the prompt is red:

1. **Never paste anything that includes a password into the chat with an AI assistant.** Including masked diagnostic output. Passwords have leaked into AI chats from "harmless-looking" diagnostics multiple times — assume it'll happen again unless you actively prevent it.
2. **Read every command twice before pressing Enter.** You don't get an undo.
3. **For destructive commands** (DROP, DELETE without WHERE, TRUNCATE, UPDATE without WHERE), wrap in a transaction so you can roll back:

   ```sql
   BEGIN;
   DELETE FROM some_table WHERE some_condition;
   -- Verify the count looks right with SELECT
   -- If it does: COMMIT;
   -- If not:    ROLLBACK;
   ```

4. **Run `Clear-DBEnv` and close the terminal when done.** Don't leave a prod-connected shell open longer than needed.

## Connecting locally to dev Supabase for the first time

After cloning the repo, you'll need an `.env.local` with the dev Supabase URL and keys so the local Next.js dev server hits dev. Get them from the SIGNAL DEV project's Connect modal:

```
NEXT_PUBLIC_SUPABASE_URL=https://zydrqckpwidipwbhrfgd.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from Settings → API>
SUPABASE_SERVICE_ROLE_KEY=<service role key from Settings → API>
```

Then `npm run dev` and the app runs locally against SIGNAL DEV's database.

The repo also has `.env.example` documenting which variables are required. Keep `.env.example` in sync when new variables are added.

## Vercel environment configuration

Each Vercel deploy environment has its own set of env variables.

- **Production deploys** (from `main` branch) point at WRNSignal Supabase. Configured under Vercel → Settings → Environment Variables → "Production."
- **Preview deploys** (from `dev` branch and any other non-main branches) point at SIGNAL DEV Supabase. Configured under Vercel → Settings → Environment Variables → "Preview."

When you add or rotate a Supabase key, you have to update both. Check both lists when setting up a new env variable. Forgetting to set the Preview values is the most common cause of "it works locally but staging is broken" reports.

## Rolling back a code deploy

We don't tag releases. We rely on Vercel's deploy history.

If something just shipped to prod and is broken:

1. Open Vercel → Project → Deployments.
2. Find the previous good deploy (the one before the broken one).
3. Click the `...` menu → "Promote to Production."
4. The previous code is now live again, usually within seconds.

This rolls back **code only**, not schema. If the broken deploy included a destructive schema change, the rollback won't undo that — see the schema rollback section above.

After a rollback, fix forward on dev and re-promote when ready. Don't try to commit-revert on main; just go through the normal dev → main flow.

## Things that have bitten us before

A list of specific failure modes we've already lived through, so we don't repeat them.

### Pasting raw SQL into prod's SQL Editor for months

**The problem:** Schema migrations got applied to prod by hand via the Supabase dashboard SQL Editor. The `supabase_migrations` tracking table never got updated. Dev Supabase fell months behind because nobody applied the same SQL there. Eventually dev was so far out of date that staging deploys couldn't run.

**The fix:** schema changes go through `.sql` files in `supabase/migrations/`. They run against dev first, then prod. Both via the dashboard SQL Editor for now (until we set up `supabase db push` properly).

**The deeper fix (later):** use the Supabase CLI's migration system properly. `supabase db push` against linked dev project, verify, then `supabase link` to prod and push there. Tracks everything in `supabase_migrations` automatically. Worth investing in once schema changes pick up frequency.

### IPv6-only Supabase direct connections

**The problem:** Supabase moved direct database connections (`db.<ref>.supabase.co`) to IPv6 only. Most US home internet doesn't have working IPv6. `pg_dump` errors with "Name or service not known."

**The fix:** use the Session pooler connection (port 5432, hostname includes `pooler`), not the Direct connection. The Session pooler is on IPv4. Only use Direct if you specifically need it and have IPv6.

### Supabase CLI's db dump requires Docker

**The problem:** `supabase db dump` shells out to a Docker image to run `pg_dump`. If Docker Desktop isn't running (or, like sometimes happens, hangs on startup), the CLI fails with a confusing 500 error mentioning Docker.

**The fix:** install raw `pg_dump` (Postgres 17.x via winget or the official installer). Use it directly with a connection URL — no Docker required.

### Passwords in PowerShell paste

**The problem:** PowerShell's `Read-Host -AsSecureString` sometimes silently fails to capture pasted input, returning an empty string. You spend 30 minutes debugging "wrong password" errors when actually the password was never read.

**The fix:** use the file-based approach. `notepad pw.tmp`, paste, save, close, then `Get-Content pw.tmp -Raw | Trim()`. Always print `$plainPw.Length` before continuing — if it's 0, the read failed and you'll know immediately instead of after building a broken URL.

### Special characters in DB passwords

**The problem:** `@`, `:`, `/`, `$`, `!` and other URL-special characters in a password break URI parsing. The URL `postgresql://postgres.ref:Foo@Bar@host` parses ambiguously and the connection fails with misleading errors.

**The fix:** always URL-encode the password before embedding in a connection string. PowerShell:

```powershell
Add-Type -AssemblyName System.Web
$encodedPw = [System.Web.HttpUtility]::UrlEncode($plainPw)
```

### Username format for Session pooler

**The problem:** The Session pooler requires the username to be `postgres.<project_ref>`, not just `postgres`. If the URL is malformed and only `postgres` reaches the server, you get an auth error that says "user postgres" — misleadingly suggesting the password is wrong.

**The fix:** always verify the username in the assembled URL before connecting. The masked-URL diagnostic:

```powershell
$env:DEV_DB_URL_PLAIN -replace '://([^:]+):[^@]+@', '://$1:***@'
```

should print the full username including the project ref.

## Things we should set up but haven't yet

Honest list of gaps. When you hire an engineer, this is roughly the list of "things to professionalize":

- **Migrations through CLI, not dashboard SQL Editor.** Use `supabase db push` with proper migration tracking.
- **A test plan.** Right now testing is "click around the staging URL and see if anything seems off." A real test plan would document specific user flows that have to work before promoting to prod.
- **Tagged releases.** `git tag v1.x.y` on every prod merge with release notes. Makes rollback trivial and gives you a release history.
- **Database backups outside Supabase's defaults.** Supabase's free tier has limited PITR. Periodic schema-only dumps to a separate bucket would protect against catastrophic data loss.
- **Environment-specific Stripe keys verified end-to-end.** Currently we trust that Vercel's Preview environment has dev Stripe keys; we should verify that periodically by running a test purchase against staging.
- **Monitoring.** No alerting if prod errors spike. A free Sentry tier or even a Vercel log integration would catch problems before users report them.
- **A real seed script.** Dev Supabase is structurally identical to prod but has no data. A `seed.sql` would create a known-good test user, test client_profile, test jobfit_run for any new engineer onboarding.

## When in doubt

- If you're about to run something destructive and you're not sure about the consequences: **stop, back up first, ask.**
- If you're about to run something against prod and your prompt isn't red: **stop, run `Use-ProdDB` to make it red, then proceed.**
- If something breaks in prod: **roll back via Vercel first, fix on dev second.** Don't try to fix prod live.
- If you find yourself pasting SQL into the prod dashboard repeatedly without it going through dev first: **stop.** That's the bad-habit pattern that causes the dev/prod drift problem in the first place.

---

*Last updated: April 2026. If this doc is wrong, fix it. The doc is part of the codebase, not separate from it.*
