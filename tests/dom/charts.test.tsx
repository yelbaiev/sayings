import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderInApp } from "./harness";
import { CashflowChart, TrendChart } from "~/features/reports/charts";

/**
 * The two charts, and specifically the three things that were wrong with the one they replace.
 *
 * jsdom has no ResizeObserver, so both render at the fallback width — which makes the geometry
 * deterministic and the assertions about it meaningful.
 */

/**
 * The line is a monotone cubic path, so its data points are the `M` and the end of every `C`.
 * The control points in between are not values anyone typed.
 */
const dataPoints = (d: string) =>
  [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)]
    .map((m) => ({ x: Number(m[1]), y: Number(m[2]) }))
    .filter((_, i) => i % 3 === 0);

const trend = [
  { period: "2026-01", total: 40_000_000 },
  { period: "2026-02", total: 44_000_000 },
  { period: "2026-03", total: 48_000_000 },
];

const cashflow = [
  { period: "2026-01", income: 500_000, expenses: 200_000, net: 300_000 },
  { period: "2026-02", income: 500_000, expenses: 800_000, net: -300_000 },
];

describe("the net-worth line", () => {
  it("blurs with every other amount in privacy mode", () => {
    /*
     * The regression this exists for. Privacy mode blurs `.sensitive` so the screen can be handed
     * to someone else; the old chart marked its figure and left the plot crisp, which draws the
     * shape of the household's savings for anyone looking.
     */
    const { container } = renderInApp(
      <TrendChart points={trend} currency="UAH" title="Чистые активы" />,
    );
    expect(container.querySelector("svg")?.classList.contains("sensitive")).toBe(true);
  });

  it("scales to the data rather than pinning the floor at zero", () => {
    /*
     * 400k to 480k is the whole story of that series. Forcing zero into the range flattens it
     * into a line along the top of an empty box — and makes two months' screenshots incomparable,
     * because each is scaled by its own maximum against a fixed floor.
     */
    const { container } = renderInApp(
      <TrendChart points={trend} currency="UAH" title="Чистые активы" />,
    );
    const d = container.querySelector('path[fill="none"]')?.getAttribute("d") ?? "";
    const ys = dataPoints(d).map((point) => point.y);

    expect(ys).toHaveLength(3);
    // The climb uses the height it has: the first point sits near the bottom of the plot and the
    // last near the top, rather than all three crowding one band.
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(80);
  });

  it("reads a period out when it is touched, and has the numbers in a table besides", async () => {
    // A tooltip must never be the only way to reach a value.
    const { container } = renderInApp(
      <TrendChart points={trend} currency="UAH" title="Чистые активы" />,
    );

    const svg = container.querySelector("svg")!;
    // Three points across a 320-wide fallback: the middle one sits around x = 160.
    fireEvent.pointerDown(svg, { clientX: 160, pointerId: 1 });
    expect(screen.getByRole("status").textContent).toMatch(/440\s*000/u);

    await userEvent.click(screen.getByRole("button", { name: "Таблица" }));
    expect(screen.getByRole("table").textContent).toMatch(/480\s*000/u);
  });

  it("follows a finger along the curve without needing a new press", () => {
    /*
     * The difference between tapping and scrubbing. The pointer is captured on the way down, so
     * moves keep arriving as the finger slides — including past the edge of the plot, where they
     * clamp to the last point rather than stopping.
     */
    const { container } = renderInApp(
      <TrendChart points={trend} currency="UAH" title="Чистые активы" />,
    );
    const svg = container.querySelector("svg")!;
    const readout = () => screen.getByRole("status").textContent ?? "";

    fireEvent.pointerDown(svg, { clientX: 0, pointerId: 1 });
    expect(readout()).toMatch(/400\s*000/u);

    fireEvent.pointerMove(svg, { clientX: 160, pointerId: 1 });
    expect(readout()).toMatch(/440\s*000/u);

    fireEvent.pointerMove(svg, { clientX: 9_999, pointerId: 1 });
    expect(readout()).toMatch(/480\s*000/u);
  });

  it("marks the point it is reading, on the curve itself", () => {
    // Text moving above a chart that shows no sign of what it is reading is not a readout.
    const { container } = renderInApp(
      <TrendChart points={trend} currency="UAH" title="Чистые активы" />,
    );
    const svg = container.querySelector("svg")!;

    expect(container.querySelectorAll("line")).toHaveLength(0);
    fireEvent.pointerDown(svg, { clientX: 160, pointerId: 1 });
    // A crosshair down the plot, and a marker sitting on the line.
    expect(container.querySelectorAll("line")).toHaveLength(1);
    expect(container.querySelectorAll("circle").length).toBeGreaterThan(1);
  });

  it("washes under the curve without drawing a second baseline", () => {
    const { container } = renderInApp(
      <TrendChart points={trend} currency="UAH" title="Чистые активы" />,
    );
    const wash = container.querySelector('path[fill^="url("]');
    expect(wash).toBeTruthy();
    // It closes down to the plot floor, so the fill has an area rather than being a fat line.
    expect(wash!.getAttribute("d")).toMatch(/Z$/u);
    expect(container.querySelector("linearGradient")).toBeTruthy();
  });

  it("curves without inventing a dip the data never had", () => {
    /*
     * The reason the smoothing is monotone cubic rather than a plain spline. A spline through three
     * rising balances overshoots on the way, drawing a fall the household never had — on a chart of
     * savings that is not a cosmetic difference. Every control point must stay inside the interval
     * its neighbours define.
     */
    const rising = [
      { period: "2026-01", total: 100_000 },
      { period: "2026-02", total: 100_500 },
      { period: "2026-03", total: 400_000 },
    ];
    const { container } = renderInApp(
      <TrendChart points={rising} currency="UAH" title="Чистые активы" />,
    );
    const d = container.querySelector('path[fill="none"]')?.getAttribute("d") ?? "";
    const ys = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => Number(m[2]));

    // Every coordinate the curve touches, controls included, sits within the plotted range.
    const points = dataPoints(d).map((point) => point.y);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(Math.min(...points) - 0.001);
    expect(Math.max(...ys)).toBeLessThanOrEqual(Math.max(...points) + 0.001);
  });

  it("walks the series with the arrow keys", () => {
    // The one route into a pointer-driven chart for someone without a pointer.
    const { container } = renderInApp(
      <TrendChart points={trend} currency="UAH" title="Чистые активы" />,
    );
    const svg = container.querySelector("svg")!;

    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(screen.getByRole("status").textContent).toMatch(/400\s*000/u);
    fireEvent.keyDown(svg, { key: "End" });
    expect(screen.getByRole("status").textContent).toMatch(/480\s*000/u);
  });
});

describe("the cashflow columns", () => {
  it("puts income above the baseline and expense below it", () => {
    /*
     * Position, not colour, is what tells the two apart. Green and red are 4.7 ΔE apart under
     * deuteranopia — well under the 8 the palette check wants — so a reader who cannot separate
     * them still reads this chart correctly, because one series is drawn upward and the other down.
     */
    const { container } = renderInApp(<CashflowChart points={cashflow} currency="UAH" />);

    const income = [...container.querySelectorAll('path[fill="var(--income)"]')];
    const expense = [...container.querySelectorAll('path[fill="var(--expense)"]')];
    expect(income).toHaveLength(2);
    expect(expense).toHaveLength(2);

    const topOf = (node: Element) =>
      Math.min(...[...(node.getAttribute("d") ?? "").matchAll(/[ML][\d.]+,([\d.]+)/g)].map((m) => Number(m[1])));
    const bottomOf = (node: Element) =>
      Math.max(...[...(node.getAttribute("d") ?? "").matchAll(/[ML][\d.]+,([\d.]+)/g)].map((m) => Number(m[1])));

    // SVG y grows downward: every income column ends above where every expense column ends.
    expect(topOf(income[0]!)).toBeLessThan(bottomOf(expense[0]!));
  });

  it("marks the month it is reading, behind the columns", () => {
    const { container } = renderInApp(<CashflowChart points={cashflow} currency="UAH" />);
    const svg = container.querySelector("svg")!;
    const band = () => container.querySelector('rect[opacity="0.5"]');

    expect(band()).toBeNull();
    fireEvent.pointerDown(svg, { clientX: 200, pointerId: 1 });
    // Behind the second slot, not the first.
    expect(Number(band()?.getAttribute("x"))).toBeGreaterThan(0);
  });

  it("names both series in words, not only in colour", () => {
    renderInApp(<CashflowChart points={cashflow} currency="UAH" />);
    expect(screen.getByText("Доход")).toBeTruthy();
    expect(screen.getByText("Расход")).toBeTruthy();
  });

  it("reads a month out on touch, both sides and the net", () => {
    const { container } = renderInApp(<CashflowChart points={cashflow} currency="UAH" />);
    const svg = container.querySelector("svg")!;

    // Two months across 320: the second slot starts at 160.
    fireEvent.pointerDown(svg, { clientX: 200, pointerId: 1 });
    const readout = screen.getByRole("status").textContent ?? "";
    expect(readout).toMatch(/5\s*000/u);
    expect(readout).toMatch(/8\s*000/u);
    // The net is signed, because a month in deficit is the thing worth seeing at a glance.
    expect(readout).toMatch(/−3\s*000/u);
  });

  it("shares one scale between the two sides", () => {
    /*
     * Two scales would let a 300k surplus and a 300k deficit draw at different heights, which is
     * the chart telling a story the data does not.
     */
    const { container } = renderInApp(<CashflowChart points={cashflow} currency="UAH" />);
    const heightOf = (selector: string, index: number) => {
      const node = [...container.querySelectorAll(selector)][index]!;
      const ys = [...(node.getAttribute("d") ?? "").matchAll(/[ML][\d.]+,([\d.]+)/g)].map((m) => Number(m[1]));
      return Math.max(...ys) - Math.min(...ys);
    };

    // 500k income in January and 500k in February draw identically...
    expect(heightOf('path[fill="var(--income)"]', 0)).toBeCloseTo(
      heightOf('path[fill="var(--income)"]', 1),
      5,
    );
    // ...and February's 800k of expense is taller than its 500k of income, by the same measure.
    expect(heightOf('path[fill="var(--expense)"]', 1)).toBeGreaterThan(
      heightOf('path[fill="var(--income)"]', 1),
    );
  });
});
