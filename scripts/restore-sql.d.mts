/**
 * Types for the plain-JS restore helper, which the worker tests import to run the exact statements a
 * real restore runs. JavaScript for the same reason as wrangler-config.mjs: `npm run db:restore`
 * runs it with node, with no build step.
 */
export function snapshotToStatements(json: string): { statements: string[]; warnings: string[] };
