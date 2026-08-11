import { useEffect, useState } from "react";
import { useApp } from "~/app/AppContext";
import { getDevicePrefs, setDevicePrefs } from "~/db/dexie";
import { Button } from "~/ui/Button";

/**
 * Prompts installation to the home screen, which is worth more than any layout change we can
 * make: running in Safari costs roughly 160px to the address bar and toolbar, on a sheet that is
 * already fighting for vertical space. It also stops iOS evicting the local database, which for
 * an offline-first app is the difference between working on the underground and not.
 *
 * Dismissible and remembered per device, because a banner that cannot be dismissed is worse than
 * the problem it describes.
 */
export function InstallBanner() {
  const { t } = useApp();
  const [show, setShow] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS Safari predates display-mode and reports this instead.
      (navigator as unknown as { standalone?: boolean }).standalone === true;

    if (standalone) return;
    void getDevicePrefs().then((prefs) => setShow(!prefs.installPromptSeen));
  }, []);

  if (!show) return null;

  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);

  return (
    <div className="mb-4 flex flex-col items-start rounded-lg border border-primary/40 bg-secondary p-4">
      <strong className="text-xs">{t("install.banner")}</strong>
      {isIos && <p className="mt-1 text-xs text-muted-foreground">{t("install.bannerIos")}</p>}
      <Button
        variant="ghost"
        size="sm"
        layoutClassName="mt-1.5 -ml-3"
        onClick={() => {
          setShow(false);
          void setDevicePrefs({ installPromptSeen: true });
        }}
      >
        {t("install.dismiss")}
      </Button>
    </div>
  );
}
