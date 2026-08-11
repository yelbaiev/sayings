import {
  ArrowLeftRight,
  ChartNoAxesColumn,
  Download,
  Eye,
  EyeOff,
  History,
  House,
  Plus,
  RefreshCw,
  Settings,
  Share,
  X,
} from "lucide-react";

/**
 * Chrome icons — lucide, behind this app's own names.
 *
 * The rule this file establishes is unchanged: **SVG for chrome, emoji for data.** Chrome —
 * navigation, affordances, anything that is part of the app rather than the ledger — must look
 * identical on every platform, so it cannot rely on Unicode: `⚙` has Emoji_Presentation and iOS
 * drew it full-colour beside monochrome siblings. Emoji stay where they *are* the data: category
 * and account icons, chosen by the user, where colour is the point.
 *
 * lucide replaced nine hand-drawn SVGs (ADR 0006). Same visual language — 24×24 box, 2px stroke,
 * round caps, `currentColor` — so the swap is invisible; what changed is that the next icon is an
 * import rather than an afternoon. The app's own names stay so call sites read as intent
 * ("ReportsIcon") rather than as lucide's taxonomy ("ChartNoAxesColumn"), and so swapping an icon
 * for a better one is one line here rather than a find-and-replace.
 */

interface IconProps {
  /** Rendered size in px. The nav uses 22; inline uses match their text. */
  size?: number;
}

export function HomeIcon({ size = 22 }: IconProps) {
  return <House size={size} aria-hidden />;
}

export function HistoryIcon({ size = 22 }: IconProps) {
  return <History size={size} aria-hidden />;
}

export function ReportsIcon({ size = 22 }: IconProps) {
  return <ChartNoAxesColumn size={size} aria-hidden />;
}

export function SettingsIcon({ size = 22 }: IconProps) {
  return <Settings size={size} aria-hidden />;
}

export function PlusIcon({ size = 26 }: IconProps) {
  return <Plus size={size} aria-hidden />;
}

export function TransferIcon({ size = 18 }: IconProps) {
  return <ArrowLeftRight size={size} aria-hidden />;
}

export function CloseIcon({ size = 20 }: IconProps) {
  return <X size={size} aria-hidden />;
}

export function ShareIcon({ size = 20 }: IconProps) {
  return <Share size={size} aria-hidden />;
}

export function DownloadIcon({ size = 20 }: IconProps) {
  return <Download size={size} aria-hidden />;
}

export function RefreshIcon({ size = 20 }: IconProps) {
  return <RefreshCw size={size} aria-hidden />;
}

export function EyeIcon({ size = 20 }: IconProps) {
  return <Eye size={size} aria-hidden />;
}

export function EyeOffIcon({ size = 20 }: IconProps) {
  return <EyeOff size={size} aria-hidden />;
}
