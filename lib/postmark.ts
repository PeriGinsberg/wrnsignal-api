import { ServerClient } from "postmark"

if (!process.env.POSTMARK_API_KEY) {
  throw new Error("POSTMARK_API_KEY is not set")
}

export const postmarkClient = new ServerClient(process.env.POSTMARK_API_KEY)

export const FROM_EMAIL = process.env.POSTMARK_FROM_EMAIL!
export const MESSAGE_STREAM = process.env.POSTMARK_MESSAGE_STREAM!
