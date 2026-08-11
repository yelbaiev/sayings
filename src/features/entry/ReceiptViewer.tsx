import { useState } from "react";
import { useApp } from "~/app/AppContext";
import { Sheet } from "~/ui";
import { IconButton, buttonVariants } from "~/ui/Button";
import { cn } from "~/lib/cn";
import { DownloadIcon, ShareIcon } from "~/ui/icons";

/**
 * Full-screen view of one receipt.
 *
 * Built on `Sheet` rather than as its own overlay, which is the second attempt. The first was a
 * separate dialog, and every way it differed from a sheet was a defect rather than a decision: its
 * dismiss sat on the left where every other dialog puts it on the right, the dismiss carried a scrim
 * the sheet's does not, its surface was 88% opaque so the form underneath showed through the header,
 * and its image had square corners against a rounded panel.
 *
 * None of those were choices. They were the cost of having two dialogs. Using the one primitive makes
 * position, opacity, corners, Escape, backdrop dismissal and the desktop centring all inherited, and
 * the only thing left to write is the two actions that are actually specific to a photo.
 */
export function ReceiptViewer({ receiptKey, onClose }: { receiptKey: string; onClose: () => void }) {
  const { t } = useApp();
  const [copied, setCopied] = useState(false);
  const url = `/api/receipts/${receiptKey}`;

  async function share() {
    const absolute = new URL(url, window.location.origin).toString();
    try {
      // The file, not the link: the link is behind Access and no use to anyone else, and sending the
      // photo to someone is usually the reason for sharing it at all.
      const response = await fetch(url);
      const blob = await response.blob();
      const file = new File([blob], "receipt.webp", { type: blob.type });

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
      if (navigator.share) {
        await navigator.share({ url: absolute });
        return;
      }
      await navigator.clipboard.writeText(absolute);
      setCopied(true);
    } catch {
      // A cancelled share sheet throws. Not an error worth reporting.
    }
  }

  return (
    <Sheet
      title={t("entry.receipt")}
      onClose={onClose}
      bodyClassName="viewer__body"
      actions={
        <>
          <IconButton
            label={copied ? t("entry.receiptCopied") : t("entry.receiptShare")}
            onClick={() => void share()}
          >
            <ShareIcon />
          </IconButton>
          {/* A plain anchor styled as the same control: `download` is the browser's own save, which
              works against the cached object with no code of ours. */}
          <a
            className={cn(buttonVariants({ variant: "ghost", size: "icon" }))}
            href={url}
            download={`receipt-${receiptKey.slice(-12)}`}
            aria-label={t("entry.receiptSave")}
            title={t("entry.receiptSave")}
          >
            <DownloadIcon />
          </a>
        </>
      }
    >
      <img className="block w-full rounded-lg" src={url} alt={t("entry.receipt")} />
    </Sheet>
  );
}
