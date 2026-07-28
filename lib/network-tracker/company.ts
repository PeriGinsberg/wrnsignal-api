// lib/network-tracker/company.ts
// Case-insensitive match-or-create for a board's companies. Shared by the create
// route and the CSV import so the two can't drift. New companies land blank
// (tier/status NULL), per the locked rule. Owner-scoped.

import { type SupabaseClient } from "@supabase/supabase-js"

// Escape ilike wildcards so a name with % or _ matches literally.
function likeLiteral(s: string): string {
  return s.replace(/[%_\\]/g, "\\$&")
}

// Returns the company id for `name` on this board — reusing an existing row
// (case-insensitive) or creating a blank one. A concurrent create can trip the
// uq_network_companies_name unique index (23505); re-find in that case.
export async function matchOrCreateCompany(
  supabase: SupabaseClient,
  ownerId: string,
  name: string,
): Promise<string> {
  const findMatch = async () => {
    const { data } = await supabase
      .from("network_companies")
      .select("id, name")
      .eq("client_profile_id", ownerId)
      .ilike("name", likeLiteral(name))
    return (data ?? []).find((c) => c.name.toLowerCase() === name.toLowerCase())?.id ?? null
  }

  const existing = await findMatch()
  if (existing) return existing

  const { data: created, error } = await supabase
    .from("network_companies")
    .insert({ client_profile_id: ownerId, name })
    .select("id")
    .single()
  if (error) {
    if (error.code === "23505") {
      const again = await findMatch()
      if (again) return again
    }
    throw new Error(`Company create failed: ${error.message}`)
  }
  return created.id as string
}
