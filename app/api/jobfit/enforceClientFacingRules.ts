export function enforceClientFacingRules(result: any) {
  const gateType = result?.gate_triggered?.type
  if (gateType !== "force_pass") return result

  return {
    ...result,
    decision: "Pass",
    icon: result?.icon ?? "?",
    bullets: [],
    why_codes: [],
    next_step: "Pass. Do not apply. Put that effort into a better-fit role.",
  }
}
