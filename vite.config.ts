import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { configPath } from "./scripts/wrangler-config.mjs";
import { VitePWA } from "vite-plugin-pwa";

/*
 * The version comes from package.json, which is the file the release process bumps.
 * It used to be a string literal in SettingsPage and had drifted three releases behind — which
 * matters more now than it did, because the update banner compares this against the latest
 * upstream tag. Two sources of truth for a version number is one too many.
 */
const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

/*
 * The highest migration this build of the code expects the database to have.
 *
 * Baked in at build time so the Worker can compare it against `d1_migrations` and refuse to serve
 * a database that is behind the code. Read from the directory rather than maintained by hand,
 * because a constant someone has to remember to bump is a constant that will be wrong.
 */
const expectedMigration = readdirSync(new URL("./migrations", import.meta.url))
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .at(-1);

if (!expectedMigration) throw new Error("no migrations found in ./migrations");

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __EXPECTED_MIGRATION__: JSON.stringify(expectedMigration),
  },
  plugins: [
    tailwindcss(),
    react(),
    /*
     * Pointed at the resolved config rather than the default.
     *
     * The plugin emits `dist/<name>/wrangler.json` describing what to deploy, and that is the config a
     * deploy must use — it is the one whose `main` is the *vite-built* worker, with `__APP_VERSION__`
     * and `__EXPECTED_MIGRATION__` already substituted. Building against the template and deploying
     * against the local config produced a Worker compiled straight from source by wrangler, with those
     * two constants left as bare identifiers: every /api/* request threw a ReferenceError, the client
     * read the resulting HTML error page as a sign-in redirect, and sat on a blank screen forever.
     */
    cloudflare({ configPath: configPath() }),
    VitePWA({
      registerType: "autoUpdate",
      // The API is never precached — it must always hit the network so that an expired
      // Cloudflare Access session surfaces as a redirect instead of a stale cached reply.
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      },
      manifest: false, // public/manifest.webmanifest is maintained by hand
    }),
  ],
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
});
