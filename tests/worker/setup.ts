import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll } from "vitest";

// Applies the real migrations to the test D1 once per worker, using wrangler's own migration
// applier. Isolated storage rolls each test back afterwards, so tests still start clean.
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
