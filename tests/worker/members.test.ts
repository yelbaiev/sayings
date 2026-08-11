import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { avatarColorFor, ensureMember } from "../../worker/db";
import { resetHousehold } from "./helpers";

/**
 * Who may be in a household, and how many.
 *
 * Access decides who reaches this code; anyone who does gets a member row. These tests pin the two
 * things that used to be wrong about that: a cap of four that blocked a legitimate household of six,
 * and a four-colour palette indexed by join order, so the fifth member wore the first member's colour.
 */

beforeEach(async () => {
  await resetHousehold();
});

describe("household size", () => {
  it("provisions as many members as Access lets through", async () => {
    /*
     * There used to be a cap of four, offered as a backstop against an over-broad Access policy. It
     * was the wrong shape of protection — it could not tell a household of six from a policy
     * matching a whole domain — so it blocked the legitimate case and only delayed the other. This
     * asserts the legitimate case now works.
     */
    const emails = Array.from({ length: 6 }, (_, i) => `person${i}@example.com`);
    const members = [];
    for (const email of emails) {
      members.push(await ensureMember(env.DB, { email, sub: email } as never));
    }
    expect(members).toHaveLength(6);
    expect(new Set(members.map((m) => m.id)).size).toBe(6);
  });

  it("makes the first arrival the owner and the rest members", async () => {
    const first = await ensureMember(env.DB, { email: "a@example.com", sub: "a" } as never);
    const second = await ensureMember(env.DB, { email: "b@example.com", sub: "b" } as never);
    expect(first.role).toBe("owner");
    expect(second.role).toBe("member");
  });

  it("gives six members six distinct colours", async () => {
    /*
     * The avatar is what tells two people apart at a glance in a shared list. With four colours and
     * five members the fifth took the first person's, which does not read as a cosmetic clash — it
     * reads as the other person having entered your transaction.
     */
    const ids = Array.from({ length: 6 }, (_, i) => `mem_${i}`);
    const colours = ids.map((id) => avatarColorFor(id));
    expect(new Set(colours).size).toBe(6);
  });

  it("gives an id the same colour every time", async () => {
    // Derived from the id, not from join order, so restoring a backup cannot recolour everybody.
    expect(avatarColorFor("mem_stable")).toBe(avatarColorFor("mem_stable"));
  });
});
