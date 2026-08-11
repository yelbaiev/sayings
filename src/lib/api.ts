/**
 * Access-aware API client.
 *
 * When a Cloudflare Access session expires, an authenticated `fetch` does NOT get a 401 —
 * it gets a 302 to the Access login page on another origin. Left unhandled that surfaces as
 * an opaque CORS failure, and the app silently stops talking to the server. This is the most
 * likely production failure in the whole design, so it is handled here, once, for every call.
 *
 * `redirect: "manual"` is what makes it detectable: the redirect becomes an opaque response
 * with `type === "opaqueredirect"` instead of a thrown TypeError.
 */

const REAUTH_GUARD_KEY = "sayfinance:reauth-attempted";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Which door the server thinks the person should be shown: claim a fresh install, or log in. */
    readonly authState?: "unclaimed" | "login",
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Thrown when the Access session is gone and a full page navigation is required. */
export class ReauthRequiredError extends Error {
  constructor() {
    super("Cloudflare Access session expired");
    this.name = "ReauthRequiredError";
  }
}

/**
 * Hands the browser back to Access so it can re-authenticate in a top-level context.
 * Guarded by sessionStorage: if a reload does not fix it, we must not loop forever on a
 * phone — better to surface the error to the caller.
 */
function requestReauth(): never {
  if (sessionStorage.getItem(REAUTH_GUARD_KEY)) {
    throw new ReauthRequiredError();
  }
  sessionStorage.setItem(REAUTH_GUARD_KEY, "1");
  window.location.assign(window.location.href);
  throw new ReauthRequiredError();
}

/** Called after any successful API response, so a later expiry can reload again. */
function clearReauthGuard(): void {
  sessionStorage.removeItem(REAUTH_GUARD_KEY);
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    redirect: "manual",
    headers: { Accept: "application/json", ...init.headers },
  });

  // An Access redirect: opaque under redirect:"manual", status 0.
  if (response.type === "opaqueredirect" || response.status === 0) {
    requestReauth();
  }

  // A same-origin login or interstitial page: 200, but HTML rather than our JSON.
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    requestReauth();
  }

  const body = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new ApiError(
      body.error ?? `Request failed with ${response.status}`,
      response.status,
      (body as { authState?: "unclaimed" | "login" }).authState,
    );
  }

  clearReauthGuard();
  return body;
}

export interface Me {
  id: string;
  email: string;
  display_name: string;
  locale: string;
  default_account_id?: string | null;
  role: string;
  household_id: string;
  /** The household's reporting currency. Every total in the app rolls up to this. */
  base_currency: string;
  /** The currencies accounts may be denominated in. Always includes the base. */
  enabled_currencies: string[];
  /** True on a fresh installation that has neither chosen its currencies nor recorded anything. */
  needs_currency_setup?: boolean;
}

export const getMe = () => apiFetch<Me>("/api/me");

/**
 * Saves the household's currency configuration.
 *
 * Goes straight to the API rather than through the outbox, unlike every other write in this app. The
 * setting is not ledger data and is not mirrored locally, and it is the one write where succeeding
 * offline would be wrong: the client would start pricing in a base the server has never heard of.
 */
export const setCurrencies = (base: string, enabled: string[]) =>
  apiFetch<{ base: string; enabled: string[] }>("/api/household/currencies", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base, enabled }),
  });

export interface RepriceResult {
  base: string;
  dates: number;
  transactions: number;
  /** Above zero means call again. The work is bounded per request so it cannot exceed a CPU limit. */
  remaining: number;
  skippedDates: string[];
}

/**
 * Changes the reporting currency, re-pricing history in bounded steps.
 *
 * Loops here rather than in the component, so the caller sees one promise and cannot accidentally
 * leave a household half-converted by unmounting between steps. The step cap is a backstop against a
 * server that keeps reporting work remaining — a runaway loop against one's own database is a worse
 * failure than stopping with a number to report.
 */
export async function changeBaseCurrency(
  base: string,
  onProgress?: (done: number, remaining: number) => void,
): Promise<RepriceResult> {
  let result = await apiFetch<RepriceResult>("/api/household/base", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base }),
  });

  let done = result.transactions;
  onProgress?.(done, result.remaining);

  for (let step = 0; result.remaining > 0 && step < 200; step++) {
    result = await apiFetch<RepriceResult>("/api/household/base", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `resume` skips the backup: one snapshot per change, not one per batch.
      body: JSON.stringify({ base, resume: true }),
    });
    done += result.transactions;
    onProgress?.(done, result.remaining);
  }

  return result;
}

export interface Health {
  ok: boolean;
  /** False when Cloudflare Access has not been set up on this deployment yet. */
  configured: boolean;
}

/**
 * The one unauthenticated endpoint, and the only call that must not go through `apiFetch`.
 *
 * `apiFetch` treats a non-JSON reply as an expired session and navigates the page to re-authenticate.
 * That is right for every authenticated call and wrong for this one: it is asked precisely when
 * something is already wrong, and a redirect loop is the last thing a broken deployment needs.
 * Any failure here answers "unknown", and the caller falls back to showing the original error.
 */
export async function getHealth(): Promise<Health | null> {
  try {
    const response = await fetch("/api/health", {
      headers: { Accept: "application/json" },
      redirect: "manual",
    });
    if (!response.headers.get("content-type")?.includes("application/json")) return null;
    return (await response.json()) as Health;
  } catch {
    return null;
  }
}

export interface ReleaseInfo {
  tag: string;
  published_at: string;
  notes: string;
  url: string;
}

export interface VersionInfo {
  current: string;
  latest: ReleaseInfo | null;
  updateAvailable: boolean;
  checkEnabled: boolean;
}

export const getVersion = () => apiFetch<VersionInfo>("/api/version");

export interface StoredReceipt {
  key: string;
  bytes: number;
  type: string;
}

/**
 * Uploads a receipt as raw bytes rather than multipart form data.
 *
 * There is one file and no fields, so a multipart envelope would only add a boundary to parse — and
 * the Worker deliberately ignores any content type the request claims, inferring it from the bytes
 * instead. Sending the blob directly makes that explicit.
 */
export const uploadReceipt = (blob: Blob) =>
  apiFetch<StoredReceipt>("/api/receipts", { method: "POST", body: blob });

/** Best-effort: a leftover object costs a few hundred kilobytes, a failed save costs the entry. */
export const deleteReceipt = (key: string) =>
  apiFetch<{ removed: boolean }>(`/api/receipts/${key}`, { method: "DELETE" }).catch(
    () => ({ removed: false }),
  );

/* -------------------------------------------------------------------------- passkeys */

/**
 * The passkey ceremonies. Options come from the server with a challenge id; the browser's
 * authenticator answers; verify sets the session cookie. The heavy lifting — CBOR, COSE,
 * signatures — lives in @simplewebauthn on both ends.
 */
export interface CeremonyOptions {
  challengeId: string;
  options: Record<string, unknown>;
}

const post = <T>(path: string, body: unknown) =>
  apiFetch<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export const authClaimOptions = () => post<CeremonyOptions>("/api/auth/claim/options", {});
export const authClaimVerify = (payload: {
  challengeId: string;
  name: string;
  response: unknown;
}) => post<{ id: string }>("/api/auth/claim/verify", payload);

export const authLoginOptions = () => post<CeremonyOptions>("/api/auth/login/options", {});
export const authLoginVerify = (payload: { challengeId: string; response: unknown }) =>
  post<{ id: string }>("/api/auth/login/verify", payload);

export const authInviteOptions = (inviteToken: string) =>
  post<CeremonyOptions>("/api/auth/invite/options", { inviteToken });
export const authInviteVerify = (payload: {
  challengeId: string;
  inviteToken: string;
  name: string;
  response: unknown;
}) => post<{ id: string }>("/api/auth/invite/verify", payload);

export const authLogout = () => post<{ ok: boolean }>("/api/auth/logout", {});

export const createInviteLink = () =>
  post<{ token: string; path: string; expiresInHours: number }>("/api/invites", {});
