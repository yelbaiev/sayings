import { readFileSync } from "node:fs";
import { builtConfigPath, readWranglerConfig } from "./wrangler-config.mjs";

/**
 * Refuses to deploy a Worker bundle that is not actually built.
 *
 * This project has now shipped a broken deploy three times, each in a different way, and every one of
 * them reported success. Twice it was a stale bundle; once it was this: the deploy compiled
 * `worker/index.ts` straight from source, so vite's `define` never ran and `__EXPECTED_MIGRATION__`
 * survived into production as a bare identifier. Every `/api/*` request threw a ReferenceError, the
 * client read the resulting HTML error page as a sign-in redirect and stayed on a blank screen — an
 * app that looked simply dead, with a green deploy log above it.
 *
 * What these share is that nothing failed. So the check is not "did the command succeed" but "does the
 * artefact contain what only a real build puts there".
 *
 * Cheap, and it runs between build and deploy, which is the only moment it can still help.
 */

const config = readWranglerConfig();
const built = builtConfigPath(config);

/** Placeholders vite substitutes. Their survival means the bundle bypassed vite entirely. */
const UNSUBSTITUTED = ["__APP_VERSION__", "__EXPECTED_MIGRATION__"];

let manifest;
try {
  manifest = JSON.parse(readFileSync(built, "utf8"));
} catch {
  throw new Error(
    `${built} is missing. The build did not run, or it built against a different config — ` +
      `deploying now would compile the Worker from source and lose the build-time constants.`,
  );
}

const workerPath = `dist/${config.name}/${manifest.main}`;
const worker = readFileSync(workerPath, "utf8");

const survivors = UNSUBSTITUTED.filter((token) => worker.includes(token));
if (survivors.length > 0) {
  throw new Error(
    `${workerPath} still contains ${survivors.join(", ")}. ` +
      `That means it was not built by vite, and every request that reads one would throw ` +
      `a ReferenceError in production. Refusing to deploy.`,
  );
}

// The client half, checked the same way: a bundle without the current version is a stale one.
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const html = readFileSync("dist/client/index.html", "utf8");
const entry = /src="([^"]*index-[^"]*\.js)"/.exec(html)?.[1];
if (!entry) throw new Error("dist/client/index.html has no entry script — the client build is wrong.");

const client = readFileSync(`dist/client${entry.replace(/^\/?/, "/")}`, "utf8");
if (!client.includes(version)) {
  throw new Error(
    `dist/client${entry} does not contain version ${version}. ` +
      `The client bundle is stale — deploying it would ship the previous release.`,
  );
}

console.log(`✓ bundle checked: worker built by vite, client at ${version}`);
