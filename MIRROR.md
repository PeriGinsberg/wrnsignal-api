# Mirroring a Framer change from dev to prod

The SIGNAL site lives in two Framer projects, dev and prod. Each one points at
its own database and API. The code components are kept in this repo as
`framer/dev/*.txt` and `framer/prod/*.txt`, and they are kept in sync by hand.
This is the checklist for doing that. The rules come from DEVELOPMENT.md
("Code changes that affect Framer").

| | dev | prod |
|---|---|---|
| Framer project | dev project (genuine-times-909123.framer.app) | prod project (wrnsignal.workforcereadynow.com) |
| API it calls | wrnsignal-api-staging.vercel.app | wrnsignal-api.vercel.app |
| Database | SIGNAL DEV (zydrqckpwidipwbhrfgd) | WRNSignal (ejhnokcnahauvrcbcmic) |
| Repo file | `framer/dev/<file>.txt` | `framer/prod/<file>.txt` |

## The one rule

**Never copy a code component verbatim between the two projects.** The
settings in each file differ: database URL and key, API host, site URLs.
Copying dev over prod points the live site at the dev database. Make the same
LOGIC change in both files and leave each file's settings alone.

## Checklist

### 1. Dev first
- [ ] Make the change in `framer/dev/<file>.txt`.
- [ ] Before editing a render block, find every place it renders. Search the
      file for the function or the data it maps over; dead helpers exist, and
      an edit to one that nothing calls changes nothing on screen.
- [ ] Commit it.
- [ ] Paste the whole file into the matching code file in the **dev** Framer
      project (back up what is there first: select all, copy, save to a text
      file). Publish if Framer shows unpublished changes.
- [ ] Test on the dev site, against staging. Do not mirror until this passes.

### 2. Mirror to prod
- [ ] Apply the same logic change to `framer/prod/<file>.txt`, by hand or with
      a script that inserts at exact anchors and fails if an anchor is missing.
      Do not copy the dev file over the prod file.
- [ ] Verify by reverse diff, not by searching for the new lines:
      ```bash
      # lines the dev commit added, and lines the prod edit adds
      git diff <dev-commit>~1 <dev-commit> -- framer/dev/<file>.txt | grep '^+' | grep -v '^+++' > dev_added.txt
      git diff -- framer/prod/<file>.txt | grep '^+' | grep -v '^+++' > prod_added.txt
      diff dev_added.txt prod_added.txt          # must print nothing
      git diff -- framer/prod/<file>.txt | grep '^-' | grep -v '^---'   # must print nothing
      ```
      If the two changes are meant to differ (a setting, say), the diff shows
      exactly where, and every difference must be one you intended.
- [ ] Check the prod file's hosts are unchanged, before and after:
      ```bash
      grep -oE 'https://[a-z0-9.-]+(vercel\.app|framer\.app|workforcereadynow\.com|supabase\.co)' framer/prod/<file>.txt | sort | uniq -c
      ```
      There must be no `staging`, no `framer.app` and no dev Supabase host in a
      prod file.
- [ ] Commit the prod file on its own, saying it mirrors the dev commit.

### 3. Paste into prod Framer, after the API is live
- [ ] If the change reads something new from the API, promote the API to prod
      first. Pasted before that, the new code finds nothing to read.
- [ ] Back up the current prod code file, then paste the whole
      `framer/prod/<file>.txt` into the matching code file in the **prod**
      Framer project. Publish.
- [ ] Check the change on the live site.

## Rolling back a Framer paste
Paste the backup you saved in step 3 back into the same code file and publish.
The repo history has every earlier version of each file too.
