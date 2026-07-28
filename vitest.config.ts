import { defineConfig } from "vitest/config"

// Component-test runner for the CLIENT-STATE layer (React components with
// interaction: render, fire an event, assert what the DOM does next). This is
// the layer the engine tests can't reach — a route-level test cannot see a
// control that never re-enables.
//
// ADDITIVE ONLY. The repo's existing suites are standalone tsx scripts
// (`app/api/jobfit/*.test.ts`, run via `npx tsx <file>`) that assert at import
// time with hand-rolled ok()/eq() helpers and no runner. They work; they are not
// being migrated.
//
// The two layers are kept apart by EXTENSION, which is the whole convention:
//
//   *.test.ts   → engine / pure logic → `npx tsx <file>`  (unchanged)
//   *.test.tsx  → component / client state → vitest        (this config)
//
// `include` is therefore scoped to .tsx deliberately. Widening it to .ts would
// make vitest collect the tsx scripts, which self-execute on import and would
// blow up under a runner that expects test() registrations.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["app/**/*.test.tsx", "lib/**/*.test.tsx"],
    exclude: ["node_modules/**", ".next/**", "tests/**", "signal-mobile/**"],
    restoreMocks: true,
  },
  // No jsx transform config needed: vitest 4 transforms via oxc, which picks up
  // `jsx: "react-jsx"` from tsconfig.json. (Setting `esbuild.jsx` here is
  // silently ignored on v4 and only produces a warning.)
})
