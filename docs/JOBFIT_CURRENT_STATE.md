# JobFit Current Implementation

Endpoint
POST /api/jobfit

Key Files

app/api/jobfit/route.ts
app/api/_lib/jobfitEvaluator.ts
app/api/jobfit/evaluator.ts
app/api/jobfit/signals.ts
app/api/jobfit/deterministicBulletRendererV4.ts

Pipeline

extract signals
evaluate gates
score job fit
determine decision
apply gate overrides
apply risk downgrades
render bullets
store result

Database Tables

client_profiles
jobfit_runs
