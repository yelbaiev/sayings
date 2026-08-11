import { useState } from "react";
import { useApp } from "~/app/AppContext";
import { setDevicePrefs } from "~/db/dexie";
import { Sheet } from "~/ui";
import { Button } from "~/ui/Button";
import { cn } from "~/lib/cn";

/**
 * A five-panel introduction, shown once per device.
 *
 * Deliberately small. The app is a numeric keypad, a list and a few reports — a guided tour would
 * take longer than working it out. What a newcomer actually needs is the facts that are not
 * discoverable by poking at it: that the data is theirs, that entry is meant to take seconds, that
 * any set of currencies rolls up to one configurable base, that a partner joins by a one-time link,
 * and that a backup happens without being asked. The last of those is the reason the project exists
 * and is invisible from the interface.
 *
 * Ends by opening the real entry sheet rather than a mock of it. The first transaction is the thing
 * that makes the rest make sense, and a tour that ends in a dead end teaches nothing.
 *
 * Per-device rather than per-member, following the install prompt: it is about this phone's owner
 * having seen it, and both people share one household.
 */

const PANEL_COUNT = 5;

export function IntroSheet({
  onClose,
  onAddFirst,
}: {
  onClose: () => void;
  /** Opens the entry sheet. Called from the last panel instead of just dismissing. */
  onAddFirst: () => void;
}) {
  const { t } = useApp();
  const [panel, setPanel] = useState(0);

  const dismiss = () => {
    // Marked seen on any exit, including a swipe-down. Someone who dismissed it does not want it
    // back tomorrow, and Settings has a way to replay it.
    void setDevicePrefs({ introSeen: true });
    onClose();
  };

  const finish = () => {
    void setDevicePrefs({ introSeen: true });
    onAddFirst();
  };

  const last = panel === PANEL_COUNT - 1;

  return (
    <Sheet
      title={t(`intro.${panel}.title` as "intro.0.title")}
      onClose={dismiss}
      footer={
        <div className="flex flex-col items-center gap-2 border-t border-border p-4">
          <div className="flex gap-1.5" aria-hidden>
            {Array.from({ length: PANEL_COUNT }, (_, index) => (
              <span
                key={index}
                className={cn(
                  "size-1.5 rounded-full",
                  index === panel ? "bg-primary" : "bg-border",
                )}
              />
            ))}
          </div>
          <Button
            variant="primary"
            block
            layoutClassName="mt-1"
            onClick={() => (last ? finish() : setPanel(panel + 1))}
          >
            {last ? t("intro.start") : t("intro.next")}
          </Button>
          {!last && (
            <Button variant="ghost" size="sm" onClick={dismiss}>
              {t("intro.skip")}
            </Button>
          )}
        </div>
      }
    >
      <div className="grid place-items-center gap-4 px-2 pb-4 pt-6 text-center">
        <div className="text-5xl" aria-hidden>
          {t(`intro.${panel}.icon` as "intro.0.icon")}
        </div>
        <p className="max-w-[34ch] text-muted-foreground">{t(`intro.${panel}.body` as "intro.0.body")}</p>
      </div>
    </Sheet>
  );
}
