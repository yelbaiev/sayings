import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useState } from "react";
import {
  authClaimOptions,
  authClaimVerify,
  authInviteOptions,
  authInviteVerify,
  authLoginOptions,
  authLoginVerify,
} from "~/lib/api";
import { Button } from "~/ui/Button";
import { CARD, HINT, PAGE, PAGE_TITLE } from "~/ui/recipes";

/**
 * The three doors into an installation: claim it, log in, or join by invite.
 *
 * Deliberately English-only, like the Access setup screen these replace: locale lives on the member
 * row, and none of these screens has a member yet. Also deliberately outside the router and the app
 * shell — there is no navigation to offer someone who is not signed in.
 *
 * The model (ADR-worthy and documented in SELF-HOSTING): identity is a passkey, not an email,
 * because verifying an email needs a sending provider and Cloudflare has none. A fresh deployment
 * is claimed by its first visitor; a claimed one admits people only by session, Access JWT, or a
 * one-time invite link. `authState` from the API decides which of these screens the boot shows.
 */

function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className={PAGE}>
      <div className="mx-auto max-w-md pt-[10dvh]">
        <h1 className={PAGE_TITLE}>{title}</h1>
        <div className={CARD}>{children}</div>
      </div>
    </main>
  );
}

/** WebAuthn failures are almost always a cancelled sheet; say so instead of a stack trace. */
function messageFor(error: unknown): string {
  if (error instanceof Error && error.name === "NotAllowedError") {
    return "The passkey prompt was cancelled. Try again.";
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function ClaimScreen() {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function claim() {
    setBusy(true);
    setError(null);
    try {
      const { challengeId, options } = await authClaimOptions();
      const response = await startRegistration({
        optionsJSON: options as never,
      });
      await authClaimVerify({ challengeId, name, response });
      // The session cookie is set; a clean boot picks it up and loads the app proper.
      window.location.replace("/");
    } catch (cause) {
      setError(messageFor(cause));
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Claim this installation">
      <p className="mb-3 text-sm text-muted-foreground">
        This deployment has no owner yet. Create the owner account with a passkey — FaceID, TouchID
        or your device unlock. No password, no email.
      </p>
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Your name"
        aria-label="Your name"
        autoFocus
      />
      <Button
        variant="primary"
        block
        layoutClassName="mt-3"
        disabled={busy || !name.trim()}
        onClick={() => void claim()}
      >
        {busy ? "Waiting for the passkey…" : "Create owner account"}
      </Button>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <p className={HINT}>
        Anyone else joins later by an invite link from Settings. If this is not your deployment,
        close the page.
      </p>
    </AuthShell>
  );
}

export function LoginScreen() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function login() {
    setBusy(true);
    setError(null);
    try {
      const { challengeId, options } = await authLoginOptions();
      const response = await startAuthentication({ optionsJSON: options as never });
      await authLoginVerify({ challengeId, response });
      window.location.replace("/");
    } catch (cause) {
      setError(messageFor(cause));
      setBusy(false);
    }
  }

  return (
    <AuthShell title="SAYings">
      <p className="mb-3 text-sm text-muted-foreground">Sign in with your passkey.</p>
      <Button variant="primary" block disabled={busy} onClick={() => void login()}>
        {busy ? "Waiting for the passkey…" : "Sign in"}
      </Button>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <p className={HINT}>
        Lost every device? The owner can send a new invite link — or see SELF-HOSTING.md for the
        one-line reset.
      </p>
    </AuthShell>
  );
}

/** Reached via /join#<token> — the hash keeps the token out of server logs entirely. */
export function JoinScreen() {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inviteToken = window.location.hash.slice(1);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const { challengeId, options } = await authInviteOptions(inviteToken);
      const response = await startRegistration({ optionsJSON: options as never });
      await authInviteVerify({ challengeId, inviteToken, name, response });
      window.location.replace("/");
    } catch (cause) {
      setError(messageFor(cause));
      setBusy(false);
    }
  }

  if (!inviteToken) {
    return (
      <AuthShell title="Join">
        <p className="text-sm text-muted-foreground">
          This page needs an invite link. Ask the owner to send you one from Settings.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Join this household">
      <p className="mb-3 text-sm text-muted-foreground">
        You have been invited. Pick a name and create your passkey — that is the whole sign-up.
      </p>
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Your name"
        aria-label="Your name"
        autoFocus
      />
      <Button
        variant="primary"
        block
        layoutClassName="mt-3"
        disabled={busy || !name.trim()}
        onClick={() => void join()}
      >
        {busy ? "Waiting for the passkey…" : "Join"}
      </Button>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </AuthShell>
  );
}
