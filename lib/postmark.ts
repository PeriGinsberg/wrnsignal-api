import { ServerClient } from "postmark"

// WHY THE CLIENT IS LAZY.
//
// This module used to build the ServerClient at import time and throw if
// POSTMARK_API_KEY was missing. That was survivable while only four senders
// imported it. It stops being survivable the moment a shared sender is pulled
// into ordinary request paths: any route that transitively imports this file
// would fail to load at all in an environment without the key, turning a
// missing email into a 500 on a page that was not trying to send one.
//
// So the key is read when a send is actually attempted, and the error names the
// variable rather than arriving as a module-load crash.
let client: ServerClient | null = null

export function getPostmarkClient(): ServerClient {
  if (!client) {
    const key = process.env.POSTMARK_API_KEY
    if (!key) throw new Error("POSTMARK_API_KEY is not set")
    client = new ServerClient(key)
  }
  return client
}

/**
 * Kept for the four senders written before this file changed. New code should
 * call getPostmarkClient() so the failure happens at send time.
 *
 * This is a Proxy rather than an eager `new ServerClient(...)` so that merely
 * importing it costs nothing and throws nothing; the key is still only read
 * when a method is called on it.
 */
export const postmarkClient = new Proxy({} as ServerClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getPostmarkClient() as object, prop, receiver)
  },
})

export const FROM_EMAIL = process.env.POSTMARK_FROM_EMAIL!

/** The stream every pre-2026-09-26 sender uses. */
export const MESSAGE_STREAM = process.env.POSTMARK_MESSAGE_STREAM!

// ---------------------------------------------------------------------------
// The two streams the task and plan work uses
// ---------------------------------------------------------------------------
// Split so a bounce on one side cannot damage the other's sending reputation.
// Client mail goes out on a coach's behalf to people who may never have written
// back; internal mail goes to three known addresses that always open it.
//
// The IDs are the Postmark stream IDs, created 2026-09-26. Defaults are given
// because these are not secrets and hard-failing a task email over an unset
// non-secret would be worse than sending it on the stream it belongs on.
export const CLIENT_STREAM = process.env.POSTMARK_STREAM_CLIENT ?? "signal-client"
export const INTERNAL_STREAM = process.env.POSTMARK_STREAM_INTERNAL ?? "signal-internal"
