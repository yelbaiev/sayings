import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Currency } from "@shared/currency";
import type { Minor } from "@shared/money";
import { useApp } from "~/app/AppContext";
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
  const [active, setActive] = useState<number | null>(null);

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

  const slot = points.length > 0 ? width / points.length : width;
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
        shown && (
          <div className="mt-0.5 text-xs text-muted-foreground" role="status" aria-live="polite">
            {formatMonthShort(shown.period, locale)} ·{" "}
            <span className="sensitive">
              +{formatAmount(shown.income, currency, locale)} · −
              {formatAmount(shown.expenses, currency, locale)} ·{" "}
              {formatMoney(shown.net, currency, locale, { signed: true })}
            </span>
          </div>
        )
      }
      table={table}
    >
      <svg
        className="sensitive block w-full"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={t("reports.cashflow")}
      >
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

              {/* The hit target is the whole slot, not the column: a 6px bar is not something to
                  ask a thumb to land on. */}
              <rect
                x={index * slot}
                y={0}
                width={slot}
                height={height - axis}
                fill="transparent"
                onPointerDown={() => setActive(index)}
                onPointerEnter={() => setActive(index)}
              />
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
  const [active, setActive] = useState<number | null>(null);

  const height = 132;
  const axis = 16;
  const plot = height - axis;
  const inset = 6; // room for the end marker's ring, which would otherwise be clipped

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

  const path = points.map((point, i) => `${i === 0 ? "M" : "L"}${xOf(i)},${yOf(point.total)}`).join(" ");
  const last = points[points.length - 1];
  const shown = active !== null ? points[active] : undefined;
  const zeroInside = low < 0 && high > 0;

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
          <span className="block text-xs text-muted-foreground">
            {formatMonthShort((shown ?? last)?.period ?? "", locale)}
          </span>
        </div>
      }
      table={table}
    >
      <svg
        className="sensitive block w-full"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={title}
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

        <path
          d={path}
          fill="none"
          stroke="var(--transfer)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

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

        {points.map((point, index) => (
          <rect
            key={point.period}
            x={index * (width / points.length)}
            y={0}
            width={width / points.length}
            height={plot}
            fill="transparent"
            onPointerDown={() => setActive(index)}
            onPointerEnter={() => setActive(index)}
          />
        ))}

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
