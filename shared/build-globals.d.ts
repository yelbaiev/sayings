/**
 * Constants injected at build time by the `define` block in vite.config.ts.
 *
 * Declared under `shared/` because that directory is the one included by every tsconfig — the
 * client, the Worker, and both test projects all need to see them.
 */

/** The app's version, read from package.json so it cannot drift from the release. */
declare const __APP_VERSION__: string;

/**
 * The highest migration filename in ./migrations at build time, e.g. "0003_default_account.sql".
 * The Worker compares it against the database's own record — see worker/schema-guard.ts.
 */
declare const __EXPECTED_MIGRATION__: string;
