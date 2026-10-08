// app/api/jobfit/languageRequirement.ts
//
// A REQUIRED second language (DEF-019, C007). Santander's WM&I internship says
// "Fluency in English and Spanish is required; Portuguese proficiency is
// preferred." The keyword path never emitted anything for it (the
// bilingual_language capability is LLM-only on the job side), so a candidate
// with no Spanish saw no warning.
//
// ONLY WHEN REQUIRED. A language counts only from a clause that both names a
// language in a language context (fluent, proficient, bilingual, speak...) and
// says it is required (required, must, mandatory, essential). A clause that
// says preferred / a plus / nice to have / desired is ignored, so "Portuguese
// proficiency is preferred" never flags. English is never flagged: the resume
// itself is the evidence.
//
// The profile side is deliberately lenient: the language named anywhere in the
// resume or profile counts as shown. Under-flagging is the safe direction.

const LANGUAGES = [
  "spanish", "portuguese", "french", "german", "italian", "mandarin", "cantonese", "chinese",
  "japanese", "korean", "arabic", "hindi", "urdu", "russian", "vietnamese", "tagalog",
  "hebrew", "dutch", "polish", "haitian creole", "creole", "greek", "turkish", "farsi", "persian",
] as const

const LANGUAGE_CONTEXT = /\b(fluen\w*|proficien\w*|bilingual|multilingual|speak\w*|spoken|language|native|conversational|written|verbal|read(ing)? and writ\w*)\b/i
const REQUIRED = /\b(required|requirement|must|mandatory|essential|necessary)\b/i
const NOT_REQUIRED = /\b(preferred|preference|a plus|plus|nice to have|desired|desirable|bonus|advantage|advantageous|helpful|ideally|optional|not required)\b/i

const nameRe = (lang: string) => new RegExp(`\\b${lang.replace(/ /g, "\\s+")}\\b`, "i")

/** Clauses: lines, then sentences and semicolon parts within them. */
function clauses(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n|;|(?<=[.!?])\s+/)
    .map((c) => c.trim())
    .filter(Boolean)
}

/** Languages the job REQUIRES (never preferred), with the clause that said so. */
export function requiredLanguagesFromJob(jobText: string): { languages: string[]; line: string | null } {
  const found: string[] = []
  let line: string | null = null
  for (const c of clauses(jobText)) {
    if (!LANGUAGE_CONTEXT.test(c) || !REQUIRED.test(c) || NOT_REQUIRED.test(c)) continue
    for (const lang of LANGUAGES) {
      if (!nameRe(lang).test(c)) continue
      // "chinese" is covered by mandarin/cantonese when those are named too.
      const canonical = lang === "creole" ? "haitian creole" : lang
      if (!found.includes(canonical)) found.push(canonical)
      line = line ?? c
    }
  }
  return { languages: found, line }
}

/** Languages named anywhere in the resume or profile. */
export function languagesShownInProfile(profileText: string): string[] {
  return LANGUAGES.filter((lang) => nameRe(lang).test(profileText)).map((l) => (l === "creole" ? "haitian creole" : l))
}

export const languageLabel = (l: string) => l.replace(/\b\w/g, (c) => c.toUpperCase())
