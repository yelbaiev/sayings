import { existsSync, readFileSync } from "node:fs";

/**
 * Reads `wrangler.jsonc`, which is JSON with comments and so cannot go through `JSON.parse`.
 *
 * Needed because the backup scripts have to know the R2 bucket's name, and that name is
 * per-installation — self-hosters rename it, and the Deploy to Cloudflare button rewrites it. An
 * environment variable would be a second source of truth for something already declared once.
 *
 * The stripper is string-aware. A naive regex for `//` would mangle any config value containing a
 * URL, and `TEAM_DOMAIN` is exactly that.
 */

/** Removes `//` and block comments, plus trailing commas, without touching string contents. */
export function stripJsonc(text) {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inLine) {
      if (char === "\n") {
        inLine = false;
        out += char;
      }
      continue;
    }
    if (inBlock) {
      if (char === "*" && next === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += char;
      // A backslash escapes the next character, including a quote — skip both so an escaped
      // quote does not look like the end of the string.
      if (char === "\\") {
        out += next ?? "";
        i++;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === "/" && next === "/") {
      inLine = true;
      i++;
      continue;
    }
    if (char === "/" && next === "*") {
      inBlock = true;
      i++;
      continue;
    }
    out += char;
  }

  // Trailing commas are legal in JSONC and not in JSON. Safe here because string contents were
  // copied through above and are never re-examined.
  return out.replace(/,(\s*[}\]])/g, "$1");
}

/**
 * The config to actually use: this installation's own if it exists, otherwise the tracked template.
 *
 * The template carries blank ids and a CHANGEME audience, because it is what a new self-hoster clones.
 * Deploying it would point at a database that does not exist and ship a Worker that refuses every
 * request — so real values live in `wrangler.local.jsonc`, which is gitignored, and every script that
 * shells out to wrangler passes this path with `-c`.
 */
export function configPath() {
  return existsSync("wrangler.local.jsonc") ? "wrangler.local.jsonc" : "wrangler.jsonc";
}

export function readWranglerConfig(path = configPath()) {
  return JSON.parse(stripJsonc(readFileSync(path, "utf8")));
}

/** The R2 bucket backups are written to, or null when no bucket is bound. */
export function backupBucketName(config = readWranglerConfig()) {
  return config.r2_buckets?.[0]?.bucket_name ?? null;
}

/**
 * The config `vite build` writes, which is the one a deploy must use.
 *
 * Its `main` is the vite-built worker, with the build-time constants substituted. Deploying the source
 * config instead makes wrangler compile `worker/index.ts` itself, leaving `__EXPECTED_MIGRATION__` a
 * bare identifier — a Worker that throws on every API request while reporting a successful deploy.
 */
export function builtConfigPath(config = readWranglerConfig()) {
  return `dist/${config.name}/wrangler.json`;
}

// Lets a package.json script ask which config to pass to wrangler, without duplicating the rule in
// shell — where the test would end up written twice and drift.
if (process.argv[1]?.endsWith("wrangler-config.mjs")) {
  if (process.argv.includes("--path")) process.stdout.write(configPath());
  if (process.argv.includes("--built")) process.stdout.write(builtConfigPath());
}
