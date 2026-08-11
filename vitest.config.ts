import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const alias = {
  "~": fileURLToPath(new URL("./src", import.meta.url)),
  "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
};

// Read once here and hand to the test worker as a binding. Using wrangler's own migration
// reader (rather than parsing the .sql files by hand) means tests run against exactly the
// schema a deploy would produce.
const migrations = await readD1Migrations("./migrations");

/*
 * The build-time constants vite injects. Defined here too, because a test that mounts the real app
 * imports the modules that read them — and an undefined global is a module-scope ReferenceError, which
 * looks exactly like the bug such a test exists to catch.
 */
const buildConstants = {
  __APP_VERSION__: JSON.stringify(
    JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version,
  ),
  __EXPECTED_MIGRATION__: JSON.stringify(migrations.at(-1)?.name ?? ""),
};

/**
 * Two projects, because the two kinds of test want different runtimes:
 *
 *  - `unit`   pure functions (money, fx, reports, csv parsing) in plain Node. Fast.
 *  - `dom`    components in jsdom. Covers wiring — what renders for given data, whether a handler
 *             is connected — and deliberately not gestures or layout. jsdom has no pointer capture
 *             and no layout engine, so a test of either would pass while the bug was present. Those
 *             two gaps are covered elsewhere: gesture decisions live in pure state machines
 *             (src/lib/press-gesture.ts, swipe-gesture.ts) and appearance is checked in the
 *             gallery at /design.
 *  - `worker` runs inside workerd against a real local D1, so the sync tests exercise actual
 *             SQLite semantics rather than a mock that agrees with whatever the code does.
 */
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts", "tests/worker/auth.test.ts"],
          environment: "node",
        },
      },
      {
        resolve: { alias },
        define: buildConstants,
        test: {
          name: "dom",
          include: ["tests/dom/**/*.test.tsx"],
          environment: "jsdom",
          setupFiles: ["./tests/dom/setup.ts"],
        },
      },
      {
        resolve: { alias },
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              d1Databases: ["DB"],
              // A real local R2 bucket, so the backup and restore path is exercised against
              // actual object storage rather than a stub that agrees with the code.
              r2Buckets: ["FILES"],
              bindings: { TEST_MIGRATIONS: migrations },
            },
          }),
        ],
        test: {
          name: "worker",
          include: ["tests/worker/**/*.test.ts"],
          exclude: ["tests/worker/auth.test.ts"],
          setupFiles: ["./tests/worker/setup.ts"],
        },
      },
    ],
  },
});
