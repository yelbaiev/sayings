import { useState } from "react";
import { useApp } from "~/app/AppContext";
import { downscaleImage } from "~/lib/downscale";
import { deleteReceipt, uploadReceipt } from "~/lib/api";
import { ReceiptViewer } from "./ReceiptViewer";
import { Button } from "~/ui/Button";
import { Cluster, Stack } from "~/ui/layout";
import { cn } from "~/lib/cn";

/**
 * Attaches a photo to a transaction.
 *
 * The one part of this app that needs the network to work. Everything else is written to the local
 * database and synced later, but bytes cannot go through an outbox that carries JSON rows — so a
 * receipt is uploaded when it is attached, and the field says as much when there is no connection
 * rather than queueing something it cannot deliver.
 *
 * That is a deliberate limit, not an oversight: the alternative is holding megabytes of blobs in
 * IndexedDB with their own retry logic, on a device iOS will evict, for a field that is optional.
 * The transaction still saves offline; the photo can be added afterwards.
 */
export function ReceiptField({
  receiptKey,
  onChange,
}: {
  receiptKey: string | null;
  onChange: (key: string | null) => void;
}) {
  const { t } = useApp();
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const offline = typeof navigator !== "undefined" && navigator.onLine === false;

  async function attach(file: File) {
    setBusy(true);
    setError(null);
    try {
      // Shrunk on the device: a 4 MB photo becomes about 300 kB, which matters on mobile data at a
      // till. Also converts HEIC to JPEG so the receipt is viewable on a laptop later.
      const blob = await downscaleImage(file);
      const stored = await uploadReceipt(blob);
      // Replacing rather than adding: drop the old object so a swap does not leave it behind.
      if (receiptKey) void deleteReceipt(receiptKey);
      onChange(stored.key);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (receiptKey) {
    return (
      <Stack gap={2}>
        {/* A button, not a link: the viewer is an overlay, so it keeps the entry sheet underneath
            rather than leaving the app for a browser tab. The thumbnail is the same object as the full
            view — one upload, cached immutably, so opening it costs nothing. */}
        <button
          type="button"
          className="overflow-hidden rounded-lg border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setViewing(true)}
        >
          <img className="block size-11 object-cover" src={`/api/receipts/${receiptKey}`} alt={t("entry.receipt")} />
        </button>

        {viewing && <ReceiptViewer receiptKey={receiptKey} onClose={() => setViewing(false)} />}

        <Cluster gap={2}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void deleteReceipt(receiptKey);
              onChange(null);
            }}
          >
            {t("entry.receiptRemove")}
          </Button>
        </Cluster>
      </Stack>
    );
  }

  return (
    <Stack gap={1}>
      <label
        className={cn(
          "inline-flex min-h-11 items-center gap-2 self-start rounded-lg border border-dashed border-input",
          "px-4 text-sm font-semibold text-muted-foreground hover:bg-accent",
          busy && "cursor-progress opacity-60",
        )}
      >
        {/* `capture` opens the camera directly on a phone, which is where a receipt is photographed.
            On a desktop the same input is a file picker. */}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          disabled={busy || offline}
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Reset so choosing the same file twice still fires a change.
            event.target.value = "";
            if (file) void attach(file);
          }}
        />
        <span aria-hidden>📷</span>
        {busy ? t("entry.receiptUploading") : t("entry.receiptAdd")}
      </label>

      {offline && <p className="text-xs text-muted-foreground">{t("entry.receiptOffline")}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </Stack>
  );
}
