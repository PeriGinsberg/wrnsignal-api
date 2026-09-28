import { describe, it, expect, afterEach, vi } from "vitest"

// Re-imported per case because isProduction reads process.env at call time but
// LIVE_EMAIL_HOST is resolved at module load, so the override needs a fresh
// module to be exercised honestly.
async function freshIsProduction() {
  vi.resetModules()
  return (await import("./send")).isProduction
}

const ORIGINAL = { ...process.env }
afterEach(() => {
  process.env = { ...ORIGINAL }
})

describe("which deployments may email a real client", () => {
  it("production, on the production project: YES", async () => {
    process.env.VERCEL_ENV = "production"
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "wrnsignal-api.vercel.app"
    expect((await freshIsProduction())()).toBe(true)
  })

  it("production, on the STAGING project: NO", async () => {
    // The bug. VERCEL_ENV reads "production" for the production deployment of
    // any project, so staging was mailing clients directly.
    process.env.VERCEL_ENV = "production"
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "wrnsignal-api-staging.vercel.app"
    expect((await freshIsProduction())()).toBe(false)
  })

  it("a preview: NO", async () => {
    process.env.VERCEL_ENV = "preview"
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "wrnsignal-api.vercel.app"
    expect((await freshIsProduction())()).toBe(false)
  })

  it("a local machine: NO", async () => {
    delete process.env.VERCEL_ENV
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL
    expect((await freshIsProduction())()).toBe(false)
  })

  it("production but the host is UNKNOWN: NO, and it says so", async () => {
    // Safe by default. The failure becomes "Peri receives client mail", which
    // is loud and fixable in minutes, rather than "a test environment mailed
    // a client", which is neither.
    process.env.VERCEL_ENV = "production"
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect((await freshIsProduction())()).toBe(false)
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it("some other project entirely: NO", async () => {
    process.env.VERCEL_ENV = "production"
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "wrn-client-portal.vercel.app"
    expect((await freshIsProduction())()).toBe(false)
  })

  it("the live host can be renamed without a code change", async () => {
    process.env.VERCEL_ENV = "production"
    process.env.SIGNAL_LIVE_EMAIL_HOST = "signal.workforcereadynow.com"
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "signal.workforcereadynow.com"
    expect((await freshIsProduction())()).toBe(true)
  })

  it("and the override does not accidentally let staging through", async () => {
    process.env.VERCEL_ENV = "production"
    process.env.SIGNAL_LIVE_EMAIL_HOST = "signal.workforcereadynow.com"
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "wrnsignal-api-staging.vercel.app"
    expect((await freshIsProduction())()).toBe(false)
  })
})
