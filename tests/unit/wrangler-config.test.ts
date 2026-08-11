import { describe, expect, it } from "vitest";
// A plain .mjs build script, imported here on purpose so the parsing rule it encodes is covered by
// tests rather than trusted. It now carries a .d.mts, because vite.config.ts imports it too.
import { stripJsonc } from "../../scripts/wrangler-config.mjs";

/**
 * `wrangler.jsonc` is JSON with comments, so the backup scripts have to strip them to read the R2
 * bucket's name. Worth testing rather than eyeballing: if this quietly mangles the config, the
 * failure is a deploy that skips its pre-migration snapshot — which is the exact safeguard the
 * whole update story rests on.
 */
const parse = (text: string) => JSON.parse(stripJsonc(text)) as Record<string, unknown>;

describe("stripJsonc", () => {
  it("removes line comments", () => {
    expect(parse('{ // leading\n "a": 1 // trailing\n }')).toEqual({ a: 1 });
  });

  it("removes block comments, including multi-line ones", () => {
    expect(parse('{ /* one */ "a": 1, /*\n two\n */ "b": 2 }')).toEqual({ a: 1, b: 2 });
  });

  it("allows trailing commas", () => {
    expect(parse('{ "a": [1, 2,], "b": 2, }')).toEqual({ a: [1, 2], b: 2 });
  });

  it("leaves a URL inside a string alone", () => {
    // The reason this is not a regex. TEAM_DOMAIN is a URL, and a naive /\/\/.*$/ would eat the
    // rest of the line and produce invalid JSON — or worse, valid JSON with the wrong value.
    expect(parse('{ "TEAM_DOMAIN": "https://team.cloudflareaccess.com" }')).toEqual({
      TEAM_DOMAIN: "https://team.cloudflareaccess.com",
    });
  });

  it("leaves comment-looking text inside a string alone", () => {
    expect(parse('{ "a": "not // a comment", "b": "not /* one */ either" }')).toEqual({
      a: "not // a comment",
      b: "not /* one */ either",
    });
  });

  it("handles an escaped quote before comment-looking text", () => {
    // If the escape were mishandled the scanner would think the string had ended and start
    // treating the rest of the value as code.
    expect(parse('{ "a": "say \\"hi\\" // ok" }')).toEqual({ a: 'say "hi" // ok' });
  });

  it("preserves a trailing slash in a value", () => {
    expect(parse('{ "a": "https://x.example/" }')).toEqual({ a: "https://x.example/" });
  });

  it("parses the project's own wrangler.jsonc shape", () => {
    const config = parse(`{
      // comment mentioning https://example.com/docs
      "name": "sayings",
      "vars": {
        "TEAM_DOMAIN": "CHANGEME", // set from the dashboard
        "UPDATE_CHECK": "on"
      },
      "r2_buckets": [{ "binding": "FILES", "bucket_name": "sayings-files" }],
    }`);
    expect(config.name).toBe("sayings");
    expect((config.r2_buckets as { bucket_name: string }[])[0]?.bucket_name).toBe("sayings-files");
  });
});
