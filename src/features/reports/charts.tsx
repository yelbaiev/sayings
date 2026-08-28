import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Currency } from "@shared/currency";
import type { Minor } from "@shared/money";
import { useApp } from "~/app/AppContext";
import { cn } from "~/lib/cn";
import { formatAmount, formatMoney, formatMonthShort } from "~/lib/format";
import { Amount } from "~/ui";
import { CARD, SECTION_TITLE } from "~/ui/recipes";

/**
 * The two charts the reports need, drawn by hand in SVG.
 *
 * No charting library, and not for novelty: recharts is around 100 kB for what is here a polyline
 * and a column of rectangles, this app bundles every asset locally, and a new runtime dependency
 * has to earn its place. What a library would have given for free is instead written down —
 * geometry in real pixels, a hit target per period, a table twin — and that list is short.
 *
 * Three rules the rest of the file exists to keep:
 *
 * 1. **Every figure is `sensitive`.** Privacy mode blurs amounts so the screen can be shown to
 *    someone else, and the shape of a net-worth line says as much as the number at the end of it.
 *    The chart this replaced left its plot crisp while the figure above it blurred.
 * 2. **Colour is never the only thing carrying meaning.** This app draws income green and expense
 *    red everywhere, and that pair is close to invisible under deuteranopia — measured, not
 *    guessed: ΔE 4.7 in OKLab, where 8 is the floor. So income sits above a baseline and expense
 *    below it, the legend spells both out, and the table twin has words. Someone who sees no
 *    colour at all reads these charts exactly as well.
 * 3. **The tooltip never gates a value.** Tapping a period reads it out, and everything is also in
 *    the table behind the toggle.
 */

/* The plot's real width in pixels. Geometry in a scaled viewBox distorts: a column's width and its
   rounded cap stretch with the container, and `preserveAspectRatio="none"` — what the old net-worth
   line used — stretched its 2px stroke along with them. */
function useWidth(fallback = 320): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const element = ref.current;
    // jsdom has no ResizeObserver, and neither does an old browser worth not crashing on.
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry?.contentRect.width ?? 0;
      if (next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

/**
 * Turns a pointer anywhere over the plot into an index, and keeps delivering while a finger moves.
 *
 * Two details make the difference between tapping and scrubbing on a phone. The pointer is
 * *captured* on the way down, so a finger that slides past the edge of the chart — or off it
 * entirely — keeps reporting instead of stopping at the boundary. And `touch-action: pan-y` on the
 * plot leaves the vertical axis to the browser, so the page still scrolls under a finger that
 * started on the chart while the horizontal axis belongs to us. It is the same division the swipe
 * rows use.
 */
function useScrub(count: number, indexAt: (x: number) => number) {
  const [active, setActive] = useState<number | null>(null);

  const read = (event: React.PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    // jsdom reports a zero-width box; falling back to raw coordinates keeps the maths meaningful
    // in tests instead of dividing by nothing.
    const scale = box.width > 0 ? event.currentTarget.viewBox.baseVal.width / box.width : 1;
    const x = (event.clientX - box.left) * scale;
    setActive(Math.max(0, Math.min(count - 1, indexAt(x))));
  };

  return {
    active,
    clear: () => setActive(null),
    handlers: {
      /* The same readings by keyboard, which is the only way a chart driven by pointer position is
         reachable without one. Arrow keys walk the series; Home and End jump to its ends. */
      tabIndex: 0,
      onKeyDown: (event: React.KeyboardEvent<SVGSVGElement>) => {
        const step =
          event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (step === 0 && event.key !== "Home" && event.key !== "End") return;
        event.preventDefault();
        setActive((current) => {
          if (event.key === "Home") return 0;
          if (event.key === "End") return count - 1;
          const from = current ?? (step > 0 ? -1 : count);
          return Math.max(0, Math.min(count - 1, from + step));
        });
      },
      onBlur: () => setActive(null),
      onPointerDown: (event: React.PointerEvent<SVGSVGElement>) => {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        read(event);
      },
      onPointerMove: (event: React.PointerEvent<SVGSVGElement>) => read(event),
      onPointerUp: (event: React.PointerEvent<SVGSVGElement>) => {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      },
      // A mouse leaving puts the chart back to its resting state; a finger lifting does not, because
      // the reason to lift it is to read what is under it.
      onPointerLeave: (event: React.PointerEvent<SVGSVGElement>) => {
        if (event.pointerType === "mouse") setActive(null);
      },
    },
  };
}

/** Title, an optional readout, the plot, and the table twin behind a toggle. */
function ChartFrame({
  title,
  readout,
  legend,
  table,
  children,
  containerRef,
}: {
  title: string;
  readout?: ReactNode;
  legend?: ReactNode;
  table: ReactNode;
  children: ReactNode;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { t } = useApp();
  const [showTable, setShowTable] = useState(false);

  return (
    <div className={CARD}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={SECTION_TITLE}>{title}</div>
          {readout}
        </div>
        <button
          type="button"
          className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setShowTable((v) => !v)}
          aria-expanded={showTable}
        >
          {showTable ? t("reports.hideTable") : t("reports.showTable")}
        </button>
      </div>

      {legend}

      <div ref={containerRef} className="mt-2 w-full">
        {children}
      </div>

      {showTable && <div className="mt-3 overflow-x-auto">{table}</div>}
    </div>
  );
}

function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="mt-1 flex flex-wrap gap-3">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {/* The swatch carries the identity; the label stays in text ink, because a light hue is
              illegible as text and a coloured word is one more thing to decode. */}
          <span
            aria-hidden
            className="inline-block size-2.5 rounded-full"
            // eslint-disable-next-line no-restricted-syntax -- a series colour, by definition dynamic
            style={{ background: item.color }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/**
 * A smooth path through the points, using monotone cubic interpolation.
 *
 * Not Catmull-Rom, and the difference matters for money: a plain spline overshoots between points,
 * so a curve drawn through three rising balances can dip below the lower one on its way — a fall
 * the household never had, drawn on the chart. Monotone cubic (Fritsch–Carlson) is constructed so
 * the curve never leaves the interval between neighbouring values, which is the only kind of
 * smoothing a balance chart may have.
 */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length < 3) return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");

  const n = pts.length;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1]!.x - pts[i]!.x;
    slope[i] = (pts[i + 1]!.y - pts[i]!.y) / dx[i]!;
  }

  // Tangents. A sign change means a turning point, and its tangent is flat — that is the clamp
  // that keeps the curve inside the data.
  const m: number[] = [slope[0]!];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1]! * slope[i]! <= 0) {
      m[i] = 0;
    } else {
      const w1 = 2 * dx[i]! + dx[i - 1]!;
      const w2 = dx[i]! + 2 * dx[i - 1]!;
      m[i] = (w1 + w2) / (w1 / slope[i - 1]! + w2 / slope[i]!);
    }
  }
  m[n - 1] = slope[n - 2]!;

  let d = `M${pts[0]!.x},${pts[0]!.y}`;
  for (let i = 0; i < n - 1; i++) {
    const third = dx[i]! / 3;
    d +=
      ` C${pts[i]!.x + third},${pts[i]!.y + m[i]! * third}` +
      ` ${pts[i + 1]!.x - third},${pts[i + 1]!.y - m[i + 1]! * third}` +
      ` ${pts[i + 1]!.x},${pts[i + 1]!.y}`;
  }
  return d;
}

/** A column with its far end rounded and its baseline end square, per the mark spec. */
function columnPath(x: number, width: number, zeroY: number, height: number, up: boolean): string {
  const radius = Math.min(4, width / 2, height);
  const end = up ? zeroY - height : zeroY + height;
  const sweep = up ? 1 : 0;
  const dir = up ? 1 : -1;

  return [
    `M${x},${zeroY}`,
    `L${x},${end + radius * dir}`,
    `A${radius},${radius} 0 0 ${sweep} ${x + radius},${end}`,
    `L${x + width - radius},${end}`,
    `A${radius},${radius} 0 0 ${sweep} ${x + width},${end + radius * dir}`,
    `L${x + width},${zeroY}`,
    "Z",
  ].join(" ");
}

export interface CashflowSeriesPoint {
  period: string;
  income: Minor;
  expenses: Minor;
  net: Minor;
}

/**
 * Income above the line, expense below it, month by month.
 *
 * The one question the tables answer badly: whether the household is spending more than it earns,
 * and whether that is getting worse. Reading it off the matrix means comparing two numbers across
 * twelve columns.
 *
 * Both sides share one scale — the same money per pixel above and below — so the columns can be
 * compared by eye. Two scales would let a small surplus look like a large one.
 */
export function CashflowChart({
  points,
  currency,
}: {
  points: CashflowSeriesPoint[];
  currency: Currency;
}) {
  const { t, locale } = useApp();
  const [container, width] = useWidth();
  const slotWidth = points.length > 0 ? width / points.length : width;
  const { active, handlers } = useScrub(points.length, (x) => Math.floor(x / slotWidth));

  const height = 152;
  const axis = 16; // room under the plot for the period labels
  const label = 12; // headroom top and bottom, so a direct label is never clipped by the frame
  const plot = height - axis - label * 2;
  /* The 2px surface gap, split across the baseline. Without it a month's two columns meet and read
     as one bar crossing the line, and the baseline itself disappears behind them. */
  const gap = 1;

  // Hooks first, then the guard: a period range is never empty in practice, and an early return
  // above a hook would change their order between renders.
  if (points.length === 0) return null;

  const maxIncome = Math.max(...points.map((p) => p.income), 0);
  const maxExpense = Math.max(...points.map((p) => p.expenses), 0);
  const span = maxIncome + maxExpense || 1;
  const zeroY = label + (maxIncome / span) * plot;

  const slot = slotWidth;
  // ≤24px thick, and never filling the slot: the leftover is the 2px surface gap and then air.
  const barWidth = Math.max(3, Math.min(10, slot / 2 - 1));

  const shown = active !== null ? points[active] : undefined;

  const table = (
    <table className="matrix">
      <thead>
        <tr>
          <th>{t("reports.month")}</th>
          <th>{t("kind.income")}</th>
          <th>{t("kind.expense")}</th>
          <th>{t("reports.profit")}</th>
        </tr>
      </thead>
      <tbody>
        {points.map((point) => (
          <tr key={point.period}>
            <td>{formatMonthShort(point.period, locale)}</td>
            <td className="sensitive tabular-nums">{formatAmount(point.income, currency, locale)}</td>
            <td className="sensitive tabular-nums">{formatAmount(point.expenses, currency, locale)}</td>
            <td className="sensitive tabular-nums">{formatAmount(point.net, currency, locale)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <ChartFrame
      title={t("reports.cashflow")}
      containerRef={container}
      legend={
        <Legend
          items={[
            { color: "var(--income)", label: t("kind.income") },
            { color: "var(--expense)", label: t("kind.expense") },
          ]}
        />
      }
      readout={
        /*
         * The month's figures, at the size of the thing they are.
         *
         * They were set in the same 12px muted grey as an axis label, which put the chart's whole
         * answer — did this month end up or down — below the legend in reading order and below the
         * period names in weight. The net leads, coloured by direction like every other amount in
         * the app; what came in and what went out sit under it as its parts.
         *
         * Always present, defaulting to the latest month: rendering it only while a finger was down
         * made the plot jump 16px away from the point being aimed at.
         */
        (() => {
          const point = shown ?? points[points.length - 1]!;
          return (
            <div role="status" aria-live="polite">
              <Amount
                minor={point.net}
                currency={currency}
                tone={point.net < 0 ? "expense" : "income"}
                size="hero"
                signed
              />
              <span className="block text-xs text-muted-foreground">
                {formatMonthShort(point.period, locale)} ·{" "}
                <span className="sensitive">
                  +{formatAmount(point.income, currency, locale)} · −
                  {formatAmount(point.expenses, currency, locale)}
                </span>
              </span>
            </div>
          );
        })()
      }
      table={table}
    >
      <svg
        className="sensitive block w-full touch-pan-y"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={t("reports.cashflow")}
        {...handlers}
      >
        {/* Behind the columns: the month under the finger, so the readout above is not the only
            thing that says which one is being read. */}
        {active !== null && (
          <rect
            className="chart-cursor"
            x={active * slot}
            y={0}
            width={slot}
            height={height - axis}
            rx={4}
            fill="var(--border)"
            opacity={0.5}
          />
        )}

        {/* The baseline. Solid hairline, one step off the surface — it is the thing both series are
            measured from, not decoration. */}
        <line x1={0} y1={zeroY} x2={width} y2={zeroY} stroke="var(--border)" strokeWidth={1} />

        {points.map((point, index) => {
          const centre = index * slot + slot / 2;
          const x = centre - barWidth / 2;
          const up = (point.income / span) * plot;
          const down = (point.expenses / span) * plot;

          return (
            <g key={point.period}>
              {point.income > 0 && (
                <path d={columnPath(x, barWidth, zeroY - gap, up, true)} fill="var(--income)" />
              )}
              {point.expenses > 0 && (
                <path d={columnPath(x, barWidth, zeroY + gap, down, false)} fill="var(--expense)" />
              )}
            </g>
          );
        })}

        {/*
          Two direct labels, not sixteen: the largest month on each side. A number over every column
          is unreadable at this width, and the axis, the readout and the table carry the rest.
        */}
        {[
          { value: maxIncome, index: points.findIndex((p) => p.income === maxIncome), up: true },
          { value: maxExpense, index: points.findIndex((p) => p.expenses === maxExpense), up: false },
        ]
          .filter((peak) => peak.value > 0 && peak.index >= 0)
          .map((peak) => {
            const centre = peak.index * slot + slot / 2;
            const size = (peak.value / span) * plot;
            // Anchored inward at the edges, so a wide figure cannot overflow the plot.
            const anchor = centre < 40 ? "start" : centre > width - 40 ? "end" : "middle";
            const x = anchor === "start" ? 0 : anchor === "end" ? width : centre;
            return (
              <text
                key={peak.up ? "in" : "out"}
                x={x}
                y={peak.up ? zeroY - gap - size - 4 : zeroY + gap + size + 10}
                textAnchor={anchor}
                className="fill-muted-foreground text-[10px]"
              >
                {formatAmount(peak.value, currency, locale)}
              </text>
            );
          })}

        {/* First and last period only. Twelve labels along a phone's width is a smear, and the
            readout above names whichever column is being touched. */}
        {points.length > 0 && (
          <>
            <text x={0} y={height - 4} className="fill-muted-foreground text-[10px]">
              {formatMonthShort(points[0]!.period, locale)}
            </text>
            <text
              x={width}
              y={height - 4}
              textAnchor="end"
              className="fill-muted-foreground text-[10px]"
            >
              {formatMonthShort(points[points.length - 1]!.period, locale)}
            </text>
          </>
        )}
      </svg>
    </ChartFrame>
  );
}

export interface TrendSeriesPoint {
  period: string;
  total: Minor;
}

/**
 * Net worth over time.
 *
 * A single series, so no legend: the title says what is plotted, and a box with one swatch in it
 * would only restate the title.
 *
 * The line this replaced had three faults worth naming, because each is easy to write again. It
 * scaled with `preserveAspectRatio="none"`, which stretched its 2px stroke into whatever the
 * container width made of it. It pinned the floor of its scale to zero, so a household always in
 * the black got a line hugging the top of an empty box and two screenshots of different months
 * could not be compared. And it carried no `sensitive` class, so privacy mode blurred the figure
 * above it and left the shape of the household's savings drawn in full.
 */
export function TrendChart({
  points,
  currency,
  title,
}: {
  points: TrendSeriesPoint[];
  currency: Currency;
  title: string;
}) {
  const { t, locale } = useApp();
  const [container, width] = useWidth();

  const height = 132;
  const axis = 16;
  const plot = height - axis;
  const inset = 6; // room for the end marker's ring, which would otherwise be clipped

  /* Nearest point, not the band it fell in: on a line the reader is aiming at a vertex, and
     rounding to the closest one means the marker lands where the eye already is. */
  const step = points.length > 1 ? (width - inset * 2) / (points.length - 1) : width;
  const { active, handlers } = useScrub(points.length, (x) => Math.round((x - inset) / step));

  if (points.length === 0) return null;

  const values = points.map((point) => point.total);
  /*
   * Scaled to the data, with zero included only when the data is near it.
   *
   * Forcing zero into the range flattens a line whose whole story is a slow climb from 400k to
   * 480k. Excluding it always would let a fall through zero pass unmarked, which is the one level
   * on this chart that means something.
   */
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const includeZero = dataMin > 0 && dataMin < dataMax * 0.25;
  const low = Math.min(dataMin, includeZero || dataMin < 0 ? 0 : dataMin);
  const high = Math.max(dataMax, 0);
  const span = high - low || 1;

  const xOf = (index: number) =>
    points.length === 1 ? width / 2 : inset + (index / (points.length - 1)) * (width - inset * 2);
  const yOf = (value: Minor) => inset + (1 - (value - low) / span) * (plot - inset * 2);

  const plotted = points.map((point, i) => ({ x: xOf(i), y: yOf(point.total) }));
  const path = smoothPath(plotted);
  /* A wash under the curve, at the tenth-opacity the mark spec allows. It is what makes the line
     read as a quantity rather than as a squiggle, and it is where the eye goes while scrubbing. */
  const area =
    plotted.length > 1
      ? `${path} L${plotted[plotted.length - 1]!.x},${plot} L${plotted[0]!.x},${plot} Z`
      : "";
  const last = points[points.length - 1];
  const shown = active !== null ? points[active] : undefined;
  const zeroInside = low < 0 && high > 0;
  const delta = ((shown ?? last)?.total ?? 0) - (points[0]?.total ?? 0);

  const table = (
    <table className="matrix">
      <thead>
        <tr>
          <th>{t("reports.month")}</th>
          <th>{title}</th>
        </tr>
      </thead>
      <tbody>
        {points.map((point) => (
          <tr key={point.period}>
            <td>{formatMonthShort(point.period, locale)}</td>
            <td className="sensitive tabular-nums">{formatAmount(point.total, currency, locale)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <ChartFrame
      title={title}
      containerRef={container}
      readout={
        /*
         * The figure, not only the shape. A single current value with a trend behind it is a stat
         * tile before it is a chart — the number is what gets read, and the line is what puts it in
         * context. Touching a period swaps the figure for that month's rather than adding a second
         * number beside it, so there is only ever one to read.
         */
        <div role="status" aria-live="polite">
          <Amount
            minor={(shown ?? last)?.total ?? 0}
            currency={currency}
            tone="neutral"
            size="hero"
          />
          {/*
            The change since the start of the range, beside the month. Scrubbing a net-worth line is
            rarely about the figure on its own — it is about whether it is above or below where the
            year began, which is a subtraction nobody should be doing in their head.
          */}
          <span className="block text-xs text-muted-foreground">
            {formatMonthShort((shown ?? last)?.period ?? "", locale)}
            {delta !== 0 && (
              <>
                {" · "}
                <span className={cn("sensitive", delta > 0 ? "text-income" : "text-expense")}>
                  {formatMoney(delta, currency, locale, { signed: true })}
                </span>
              </>
            )}
          </span>
        </div>
      }
      table={table}
    >
      <svg
        className="sensitive block w-full touch-pan-y"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={title}
        {...handlers}
      >
        {zeroInside && (
          <line
            x1={0}
            y1={yOf(0)}
            x2={width}
            y2={yOf(0)}
            stroke="var(--border)"
            strokeWidth={1}
          />
        )}

        {area && (
          <>
            {/* The wash fades out downward rather than ending on a hard horizontal edge, which
                reads as a second baseline the chart does not have. */}
            <defs>
              <linearGradient id="net-worth-wash" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--transfer)" stopOpacity={0.16} />
                <stop offset="100%" stopColor="var(--transfer)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <path d={area} fill="url(#net-worth-wash)" />
          </>
        )}

        {/* The finger's position: a hairline down the plot and a marker on the curve. Both ride a
            translate so they glide between months instead of teleporting — see .chart-cursor. */}
        {active !== null && shown && (
          <line
            className="chart-cursor"
            x1={xOf(active)}
            y1={0}
            x2={xOf(active)}
            y2={plot}
            stroke="var(--border)"
            strokeWidth={1}
          />
        )}

        <path
          d={path}
          fill="none"
          stroke="var(--transfer)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {active !== null && shown && (
          <circle
            className="chart-cursor"
            cx={xOf(active)}
            cy={yOf(shown.total)}
            r={5}
            fill="var(--transfer)"
            stroke="var(--card)"
            strokeWidth={2}
          />
        )}

        {/* The end marker, with a 2px ring in the surface colour so it stays legible where it sits
            on the line. */}
        {last && (
          <circle
            cx={xOf(points.length - 1)}
            cy={yOf(last.total)}
            r={4}
            fill="var(--transfer)"
            stroke="var(--card)"
            strokeWidth={2}
          />
        )}

        {points.length > 0 && (
          <>
            <text x={0} y={height - 4} className="fill-muted-foreground text-[10px]">
              {formatMonthShort(points[0]!.period, locale)}
            </text>
            <text
              x={width}
              y={height - 4}
              textAnchor="end"
              className="fill-muted-foreground text-[10px]"
            >
              {formatMonthShort(points[points.length - 1]!.period, locale)}
            </text>
          </>
        )}
      </svg>
    </ChartFrame>
  );
}

export interface DonutSlice {
  id: string;
  label: string;
  color: string;
  value: Minor;
}

/** Six named slices and a seventh for everything else. See the note on the component. */
const DONUT_SLICES = 6;

/**
 * Part-to-whole for a month's categories, with the total in the middle.
 *
 * **Six slices and a rest, not a dozen.** The report this is modelled on draws every category, and
 * past the sixth the arcs are a few pixels of hue each — too thin to point at, too close to tell
 * apart, and adjacent in colour by accident rather than by meaning. The donut answers "what is
 * most of this"; the ranked list underneath is where the tail is read, category by category, with
 * its share and its amount. Folding is not a limitation to apologise for — it is what keeps the
 * shape readable.
 *
 * Slices wear each category's **own** colour, the one on its icon everywhere else in the app. That
 * is identity the household chose, and re-colouring it here would break the only association a
 * reader already has. Colour is never the sole channel: every slice is named in the list below.
 */
export function DonutChart({
  slices,
  total,
  currency,
  label,
  caption,
}: {
  slices: DonutSlice[];
  total: Minor;
  currency: Currency;
  /** What the total is — "Total expenses". The centre needs to say what it is counting. */
  label: string;
  /** Under the figure: the period it covers. */
  caption: string;
}) {
  const { t } = useApp();
  const [active, setActive] = useState<string | null>(null);

  const ranked = [...slices].filter((slice) => slice.value > 0).sort((a, b) => b.value - a.value);
  const head = ranked.slice(0, DONUT_SLICES);
  const tail = ranked.slice(DONUT_SLICES);
  const shown: DonutSlice[] = tail.length
    ? [
        ...head,
        {
          id: "__rest",
          label: t("reports.otherCategories", { count: tail.length }),
          color: "var(--muted-foreground)",
          value: tail.reduce((sum, slice) => sum + slice.value, 0),
        },
      ]
    : head;

  const size = 208;
  const stroke = 26;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const sum = shown.reduce((acc, slice) => acc + slice.value, 0) || 1;
  /* The 2px surface gap the mark spec asks for, expressed as arc length. Never a stroke drawn
     around a slice — that adds ink that is not data. */
  const gap = shown.length > 1 ? 2 : 0;

  const selected = shown.find((slice) => slice.id === active);
  const centreValue = selected ? selected.value : total;

  /* Arc lengths and their starting offsets, computed once. Accumulating a running offset inside
     the map would be a mutation during render, which the compiler rejects — rightly, since a second
     pass would start from wherever the first one left it. */
  const arcs = shown.reduce<{ slice: DonutSlice; dash: number; offset: number }[]>(
    (acc, slice) => {
      const previous = acc[acc.length - 1];
      const offset = previous ? previous.offset + (previous.slice.value / sum) * circumference : 0;
      const length = (slice.value / sum) * circumference;
      return [...acc, { slice, dash: Math.max(0, length - gap), offset }];
    },
    [],
  );

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <svg
          className="sensitive block"
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={label}
        >
          {/* Rotated so the first and largest slice starts at twelve o'clock, where the eye does. */}
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            {arcs.map(({ slice, dash, offset }) => (
              <circle
                key={slice.id}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={slice.color}
                strokeWidth={active === slice.id ? stroke + 4 : stroke}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
                opacity={active && active !== slice.id ? 0.35 : 1}
                onPointerDown={() => setActive(active === slice.id ? null : slice.id)}
              />
            ))}
          </g>
        </svg>

        {/* The centre. Absolutely positioned rather than SVG text, so the figure wears the app's
            own type and the app's own Amount component rather than a second way of drawing money. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-10 text-center">
          <span className="text-xs text-muted-foreground">{selected ? selected.label : label}</span>
          <Amount minor={centreValue} currency={currency} tone="neutral" size="hero" />
          <span className="text-xs text-muted-foreground">
            {selected ? `${Math.round((selected.value / sum) * 100)}%` : caption}
          </span>
        </div>
      </div>
    </div>
  );
}

export interface PeriodBar {
  period: string;
  value: Minor;
}

/**
 * The strip of months under a report: how big each was, and which one is being read.
 *
 * It is a control before it is a chart — the way to move between months without stepping through
 * them one arrow at a time — so the selected column is filled and the rest are a track. Nine of
 * them, ending at the selected month, which is as many as fit under a thumb at phone width.
 */
export function PeriodStrip({
  bars,
  selected,
  onSelect,
  tone,
}: {
  bars: PeriodBar[];
  selected: string;
  onSelect: (period: string) => void;
  tone: "expense" | "income";
}) {
  const { locale } = useApp();
  const max = Math.max(...bars.map((bar) => bar.value), 1);

  return (
    <div className="flex items-end gap-1">
      {bars.map((bar) => {
        const isSelected = bar.period === selected;
        return (
          <button
            key={bar.period}
            type="button"
            className="min-w-0 flex-1"
            onClick={() => onSelect(bar.period)}
            aria-pressed={isSelected}
          >
            <span className="flex h-12 w-full items-end rounded-sm bg-muted">
              {/* Every month in the colour of what it measures, the chosen one at full strength.
                  Grey columns with one coloured said "buttons, one of them on"; this says "spending,
                  and this is the month you are reading". */}
              <span
                className={cn(
                  "sensitive block w-full rounded-sm",
                  tone === "income" ? "bg-income" : "bg-expense",
                  !isSelected && "opacity-30",
                )}
                // eslint-disable-next-line no-restricted-syntax -- the bar's height is its value
                style={{ height: `${Math.max(6, (bar.value / max) * 100)}%` }}
              />
            </span>
            <span
              className={cn(
                "mt-1 block truncate text-[10px]",
                isSelected ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              {formatMonthShort(bar.period, locale)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
