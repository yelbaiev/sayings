import {
  dueMessage,
  duePayments,
  kyivDate,
  recordResult,
  sendPush,
  type PushConfig,
} from "./push";

/**
 * The morning reminder: at 08:00 Kyiv time, each phone with reminders on gets one notification
 * listing its owner's due payments — and nothing at all when nothing is due.
 *
 * Runs from an hourly cron rather than one fixed UTC time, so it stays at 08:00 through the clock
 * change (decided 2026-10-04): every run after 08:00 Kyiv sends to the phones that have not had
 * today's reminder yet, and finds none on the runs after that. The same rule makes a missed run
 * (a Cloudflare hiccup at 08:07) self-healing at 09:07 instead of a lost day.
 *
 * A payment left unposted is reminded about again every morning, the same rule as the badge
 * (decided 2026-10-04): "due" is next_on <= today, so it stays due until posted or skipped.
 *
 * See docs/plans/push-reminders.md.
 */

/** From this hour, Kyiv time, a day's reminder may go out. */
export const REMINDER_HOUR = 8;

export function kyivHour(now: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", hour: "2-digit", hourCycle: "h23" }).format(now),
  );
}

export interface ReminderRun {
  sent: number;
  failed: number;
  removed: number;
}

export async function runReminders(
  db: D1Database,
  config: PushConfig | null,
  now = new Date(),
  fetcher: typeof fetch = fetch,
): Promise<ReminderRun> {
  const run: ReminderRun = { sent: 0, failed: 0, removed: 0 };
  if (!config || kyivHour(now) < REMINDER_HOUR) return run;

  const today = kyivDate(now);
  const { results } = await db
    .prepare(
      `SELECT s.endpoint, s.p256dh, s.auth, s.last_sent_at, s.member_id, m.locale
         FROM push_subscriptions s JOIN members m ON m.id = s.member_id
        WHERE m.deleted = 0`,
    )
    .all<{
      endpoint: string;
      p256dh: string;
      auth: string;
      last_sent_at: number | null;
      member_id: string;
      locale: string;
    }>();

  // Phones that have not had today's reminder, grouped by their owner — one due-list per person.
  const pending = new Map<string, { locale: string; phones: typeof results }>();
  for (const row of results) {
    if (row.last_sent_at !== null && kyivDate(new Date(row.last_sent_at)) === today) continue;
    const entry = pending.get(row.member_id) ?? { locale: row.locale, phones: [] };
    entry.phones.push(row);
    pending.set(row.member_id, entry);
  }

  for (const [memberId, { locale, phones }] of pending) {
    const due = await duePayments(db, memberId, today);
    // Nothing due: nothing sent, and nothing stamped — a payment that falls due later today (a
    // schedule created at noon) still gets its reminder on the next hourly run.
    if (due.length === 0) continue;

    const message = dueMessage(locale, due);
    for (const phone of phones) {
      // One phone's failure never stops another's reminder.
      const result = await sendPush(phone, message, config, fetcher).catch(() => "failed" as const);
      await recordResult(db, phone.endpoint, result, { daily: true, now: now.getTime() });
      if (result === "sent") run.sent++;
      else if (result === "gone") run.removed++;
      else run.failed++;
    }
  }

  return run;
}
