/**
 * Tells a self-hosted installation that a newer release exists.
 *
 * The distribution model is that everyone runs their own copy and nothing reports back to the
 * author — no telemetry, no phone-home, no central service. The cost of that is real: without
 * something like this, an installation sits on v1 indefinitely because nobody ever mentions v2 to
 * it. A GitHub "watch" subscription is the alternative, and almost nobody sets one up.
 *
 * So the check runs the only way consistent with the model: **outbound from the household's own
 * Worker, once a night, to a public endpoint.** The request asks GitHub for the latest tag of the
 * upstream repository and says nothing about who is asking — no version, no identifier, no
 * hostname beyond what any HTTP request carries. Nothing reaches the author at all; there is
 * nowhere for it to go.
 *
 * `UPDATE_CHECK: "off"` disables it. A self-hosting audience will want that switch to exist, and
 * arguing about whether they should is more expensive than providing it.
 */

export interface ReleaseInfo {
  /** Tag as published, e.g. "v1.4.0". */
  tag: string;
  /** ISO date the release was published. */
  published_at: string;
  /** Release notes, truncated — Settings shows a summary, not a changelog. */
  notes: string;
  url: string;
}

const META_KEY = "latest_release";
const NOTES_LIMIT = 2000;

/** Placeholder-aware, like the Access config: an unconfigured repo must not be fetched. */
function isConfiguredRepo(repo: string | undefined): repo is string {
  return (
    typeof repo === "string" &&
    /^[\w.-]+\/[\w.-]+$/.test(repo) &&
    !repo.includes("CHANGEME")
  );
}

export async function fetchLatestRelease(repo: string): Promise<ReleaseInfo | null> {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: {
      Accept: "application/vnd.github+json",
      // GitHub rejects unidentified API clients. Deliberately generic: it names the software, not
      // the installation.
      "User-Agent": "SAYings-self-hosted",
    },
  });

  // 404 is the normal answer for a repository with no releases yet, not an error worth logging.
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);

  const body = (await response.json()) as {
    tag_name?: string;
    published_at?: string;
    body?: string;
    html_url?: string;
    draft?: boolean;
    prerelease?: boolean;
  };

  if (!body.tag_name || body.draft || body.prerelease) return null;

  return {
    tag: body.tag_name,
    published_at: body.published_at ?? "",
    notes: (body.body ?? "").slice(0, NOTES_LIMIT),
    url: body.html_url ?? `https://github.com/${repo}/releases`,
  };
}

/**
 * Whether the nightly check should run.
 *
 * A function rather than an inline `!== "off"` because `wrangler types` turns wrangler.jsonc vars
 * into *literal* types — `UPDATE_CHECK: "on"` — so comparing the env field against "off" is a type
 * error about two literals that cannot overlap. Widening here keeps that quirk in one place, the
 * same way AccessConfig does for the Access values.
 */
export function isUpdateCheckEnabled(value: string | undefined): boolean {
  return value !== "off";
}

/** Called from the nightly cron. Returns what it stored, or null if it did nothing. */
export async function runUpdateCheck(
  db: D1Database,
  config: { repo?: string | undefined; enabled?: string | undefined },
): Promise<ReleaseInfo | null> {
  if (!isUpdateCheckEnabled(config.enabled)) return null;
  if (!isConfiguredRepo(config.repo)) return null;

  const release = await fetchLatestRelease(config.repo);
  if (!release) return null;

  await db
    .prepare(
      `INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(META_KEY, JSON.stringify(release), Date.now())
    .run();

  return release;
}

export async function storedRelease(db: D1Database): Promise<ReleaseInfo | null> {
  const row = await db
    .prepare(`SELECT value FROM app_meta WHERE key = ?`)
    .bind(META_KEY)
    .first<{ value: string }>();
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as ReleaseInfo;
  } catch {
    // A malformed row must not break the Settings screen.
    return null;
  }
}

/**
 * Whether `latest` is newer than `current`, by semantic version.
 *
 * A string comparison gets this wrong in the one case that matters: "1.10.0" sorts *before*
 * "1.9.0" lexically, so a user on 1.9.0 would never be told about 1.10.0. Leading "v" is optional
 * because tags carry it and package.json does not.
 *
 * Anything that is not purely numeric segments answers "no". `Number.parseInt` would have been the
 * obvious tool and is the wrong one: it stops at the first non-digit, so "1.4.0-rc1" parses as
 * 1.4.0 and a release candidate gets announced as a stable update. GitHub's `releases/latest`
 * already excludes anything flagged as a prerelease, but a tag whose suffix says "rc" while the
 * flag says otherwise should still not be pushed at people running a household ledger.
 */
export function isNewer(latest: string, current: string): boolean {
  const parse = (value: string): number[] | null => {
    const bare = value.replace(/^v/i, "");
    if (!/^\d+(\.\d+)*$/.test(bare)) return null;
    return bare.split(".").map(Number);
  };

  const a = parse(latest);
  const b = parse(current);
  if (!a || !b) return false;

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}
