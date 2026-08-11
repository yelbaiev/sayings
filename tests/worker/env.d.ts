import type { D1Migration } from "@cloudflare/vitest-pool-workers";

// Adds the test-only bindings that vitest.config.ts injects.
//
// In @cloudflare/vitest-pool-workers 0.20 the `env` exported from `cloudflare:test` is typed
// as `Cloudflare.Env` (the older `ProvidedEnv` interface is gone), so the augmentation has to
// target that namespace. `declare global` is required because this file has a top-level
// import and is therefore a module.
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
