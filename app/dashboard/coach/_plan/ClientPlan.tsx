"use client"

// The Phase stepper and the Plan, together on a client record. A change in
// either reloads the other: finishing a task can move a phase, and setting a
// phase changes which phase the Plan opens on.

import { useState } from "react"
import { PhaseStepper } from "../_phases/PhaseStepper"
import { PlanSection } from "./PlanSection"
import { DriveWorkspaceLink } from "./DriveWorkspaceLink"

export function ClientPlan({ coachClientId }: { coachClientId: string | null }) {
  const [stepperKey, setStepperKey] = useState(0)
  const [planKey, setPlanKey] = useState(0)
  return (
    <>
      <DriveWorkspaceLink coachClientId={coachClientId} refreshKey={planKey} />
      <PhaseStepper coachClientId={coachClientId} refreshKey={stepperKey} onChanged={() => setPlanKey((k) => k + 1)} />
      <PlanSection coachClientId={coachClientId} refreshKey={planKey} onChanged={() => setStepperKey((k) => k + 1)} />
    </>
  )
}
