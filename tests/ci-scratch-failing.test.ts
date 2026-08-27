// SCRATCH — deliberately failing test used to prove the CI gate blocks a
// promote when GitHub Actions is red. Must be removed before this branch is
// promoted. If you are reading this on dev, something went wrong.
//
// Uses the repo's tsx-script convention (assert at import time), so
// scripts/run-tsx-tests.mjs picks it up and exits non-zero.
console.log("SCRATCH: this test fails on purpose to prove CI blocks the deploy")
process.exit(1)
