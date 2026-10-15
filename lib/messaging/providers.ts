// lib/messaging/providers.ts
//
// The providers, and which one a coach sends through.

import { getPostmarkClient, COACH_MESSAGE_STREAM } from "../postmark"
import type { MessageProvider, ProviderName } from "./types"

export const postmarkProvider: MessageProvider = {
  name: "postmark",
  async sendEmail(m) {
    try {
      const res = await getPostmarkClient().sendEmail({
        From: m.from,
        ReplyTo: m.replyTo,
        To: m.to,
        ...(m.cc ? { Cc: m.cc } : {}),
        ...(m.bcc.length ? { Bcc: m.bcc.join(", ") } : {}),
        Subject: m.subject,
        HtmlBody: m.html,
        TextBody: m.text,
        Tag: m.tag,
        MessageStream: COACH_MESSAGE_STREAM,
      })
      return { ok: true, providerMessageId: res.MessageID }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  },
}

/** The provider named in a coach's settings. Unknown names fall back to Postmark. */
export function providerFor(name: string | null | undefined): MessageProvider {
  switch (name as ProviderName) {
    case "postmark":
    default:
      return postmarkProvider
  }
}
