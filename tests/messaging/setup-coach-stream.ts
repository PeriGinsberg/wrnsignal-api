#!/usr/bin/env tsx
// Creates the Postmark stream coach messages go out on, and its delivery /
// bounce / spam-complaint webhook. Run once. A dry run unless --apply.
//
//   POSTMARK_API_KEY=... POSTMARK_WEBHOOK_SECRET=... \
//     npx tsx tests/messaging/setup-coach-stream.ts [--apply]
//
// The webhook points at production (the only database whose rows it can
// match) and carries Basic auth with POSTMARK_WEBHOOK_SECRET as the password;
// set the same value on the production Vercel project. Running it again finds
// what already exists and creates only what is missing.

import { ServerClient } from "postmark"

const STREAM = process.env.POSTMARK_STREAM_COACH ?? "signal-coach-messages"
const URL = process.env.POSTMARK_WEBHOOK_URL ?? "https://wrnsignal-api.vercel.app/api/webhooks/postmark"
const apply = process.argv.includes("--apply")

async function main() {
  const key = process.env.POSTMARK_API_KEY
  const secret = process.env.POSTMARK_WEBHOOK_SECRET
  if (!key) throw new Error("POSTMARK_API_KEY is not set")
  if (!secret) throw new Error("POSTMARK_WEBHOOK_SECRET is not set")
  const pm = new ServerClient(key)

  const streams = await pm.getMessageStreams()
  const stream = streams.MessageStreams.find((s) => s.ID === STREAM)
  if (stream) {
    console.log(`stream ${STREAM}: exists (${stream.MessageStreamType})`)
  } else if (apply) {
    await pm.createMessageStream({
      ID: STREAM,
      Name: "SIGNAL coach messages",
      MessageStreamType: "Transactional",
      Description: "Emails a coach writes to a client from SIGNAL's Message button.",
    })
    console.log(`stream ${STREAM}: created`)
  } else {
    console.log(`stream ${STREAM}: missing, would create (Transactional)`)
  }

  const hooks = stream ? (await pm.getWebhooks({ messageStream: STREAM })).Webhooks : []
  const hook = hooks.find((h) => h.Url === URL)
  if (hook) {
    console.log(`webhook ${URL}: exists (id ${hook.ID})`)
  } else if (apply) {
    const h = await pm.createWebhook({
      Url: URL,
      MessageStream: STREAM,
      HttpAuth: { Username: "postmark", Password: secret },
      Triggers: {
        Delivery: { Enabled: true },
        Bounce: { Enabled: true, IncludeContent: false },
        SpamComplaint: { Enabled: true, IncludeContent: false },
      },
    })
    console.log(`webhook ${URL}: created (id ${h.ID})`)
  } else {
    console.log(`webhook ${URL}: missing, would create (Delivery, Bounce, SpamComplaint)`)
  }
  if (!apply) console.log("\nDry run. Re-run with --apply to create what is missing.")
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1) })
