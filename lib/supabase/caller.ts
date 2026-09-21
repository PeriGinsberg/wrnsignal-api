// lib/supabase/caller.ts
//
// A Supabase client that acts AS THE CALLER: the anon key plus the request's own
// Bearer JWT. Row Level Security applies to every query made with it, which is
// the point. Every other API route uses the service role and so bypasses RLS
// entirely (see lib/collab/scope.ts); routes built on this client do not.
//
// First user: the workbook routes (app/api/coach/clients/[clientId]/workbooks,
// app/api/me/workbooks), whose tables are guarded by their policies.

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { getBearerToken } from "@/lib/collab/identity"

export function getCallerClient(req: Request): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY")
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${getBearerToken(req)}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
