import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The theme, as invariants.
 *
 * The two-layer Fluent-era token system and its tests retired with tokens.css (ADR 0006); what
 * carried over is the discipline, restated against the shadcn theme in tailwind.css and the
 * component CSS that deliberately outlives the utility migration.
 */

const tw = readFileSync(new URL("../../src/styles/tailwind.css", import.meta.url), "utf8");
const components = readFileSync(
  new URL("../../src/styles/components.css", import.meta.url),
  "utf8",
);
const main = readFileSync(new URL("../../src/main.tsx", import.meta.url), "utf8");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const twBare = stripComments(tw);
const componentsBare = stripComments(components);

/** Custom property names declared inside a selector block. */
const declared = (selector: RegExp): string[] => {
  const match = selector.exec(twBare);
  if (!match?.[1]) return [];
  return [...match[1].matchAll(/(--[\w-]+)\s*:/g)].map(([, name]) => name!).sort();
};

describe("the shadcn theme (tailwind.css)", () => {
  it("kills the default palette before defining its own", () => {
    /*
     * `--color-*: initial` is what turns "no raw colour" from a review rule into a compile error:
     * with the default palette gone, `bg-red-500` is a class that does not exist. It must come
     * before the semantic definitions or it would erase them too.
     */
    const theme = /@theme inline\s*\{([\s\S]*?)\n\}/.exec(twBare)?.[1] ?? "";
    expect(theme.indexOf("--color-*: initial")).toBeGreaterThanOrEqual(0);
    expect(theme.indexOf("--color-*: initial")).toBeLessThan(theme.indexOf("--color-background"));
  });

  it("keeps the two dark blocks twins", () => {
    // The attribute form and the media-query form must answer identically, or "system" and an
    // explicit "dark" would be two different themes.
    const attribute = declared(/\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/);
    const media = declared(/:root:not\(\[data-theme="light"\]\)\s*\{([\s\S]*?)\n\s*\}/);
    expect(attribute.length).toBeGreaterThan(10);
    expect(media).toEqual(attribute);
  });

  it("defines the money colours in both themes", () => {
    // The one place colour carries meaning. A theme without them would render every amount in
    // foreground grey and the ledger would stop being readable at a glance.
    const light = declared(/:root\s*\{([\s\S]*?)\n\}/);
    const dark = declared(/\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/);
    for (const name of ["--expense", "--income", "--transfer"]) {
      expect(light, `${name} in light`).toContain(name);
      expect(dark, `${name} in dark`).toContain(name);
    }
  });

  it("gates its hover variant on a real pointer", () => {
    // Tailwind v4's own hover variant is `(hover: hover)` alone, which some phones match — the
    // state then sticks to whatever was tapped last.
    const variant = /@custom-variant hover\s*\{([\s\S]*?)\n\}/.exec(twBare)?.[1] ?? "";
    expect(variant).toContain("hover: hover");
    expect(variant).toContain("pointer: fine");
  });

  it("keys dark on data-theme, covering both the attribute and the system preference", () => {
    const variant = /@custom-variant dark\s*\{([\s\S]*?)\n\}/.exec(twBare)?.[1] ?? "";
    expect(variant).toContain('[data-theme="dark"]');
    expect(variant).toContain("prefers-color-scheme: dark");
    expect(variant).toContain(':not([data-theme="light"])');
  });

  it("namespaces the shadcn accent variable", () => {
    // bg-accent works; the root variable stays namespaced so a future stylesheet defining a plain
    // --accent (as the legacy tokens did) cannot silently repaint every hover fill.
    expect(twBare).toContain("--shadcn-accent:");
    expect(twBare).toContain("--color-accent: var(--shadcn-accent)");
  });

  it("declares the layout metrics the arithmetic tests depend on", () => {
    expect(twBare).toMatch(/--tap:\s*44px/);
    expect(twBare).toMatch(/--key-height:\s*56px/);
  });

  it("is the single stylesheet entry", () => {
    // Two entry points is how the cascade surprises return.
    expect(main).toContain('import "~/styles/tailwind.css"');
    expect(main).not.toContain("app.css");
  });
});

describe("the component CSS (components.css)", () => {
  it("references only theme variables — no legacy token may return", () => {
    /*
     * The legacy names are retired, and a rule quietly reintroducing one would resolve to nothing:
     * an invalid var() drops the whole declaration, which is exactly the silent class of failure
     * the old token tests existed to catch.
     */
    const used = [...componentsBare.matchAll(/var\((--[\w-]+)/g)].map(([, name]) => name!);
    const legacy = used.filter((name) =>
      /^--(grey|surface|text-|control|accent-|elevation|space-|inset|toast|bg$)/.test(name),
    );
    expect(legacy, `legacy tokens: ${[...new Set(legacy)].join(", ")}`).toEqual([]);

    // And everything referenced actually exists in the theme (or is its own declared variable).
    const themeNames = new Set([...twBare.matchAll(/(--[\w-]+)\s*:/g)].map(([, n]) => n!));
    const own = new Set([...componentsBare.matchAll(/(--[\w-]+)\s*:/g)].map(([, n]) => n!));
    const unknown = used.filter((name) => !themeNames.has(name) && !own.has(name));
    expect(unknown, `undefined tokens: ${[...new Set(unknown)].join(", ")}`).toEqual([]);
  });

  it("keeps a keypad key at or above the minimum tap target", () => {
    const key = /--key-height:\s*(\d+)px/.exec(twBare);
    const tap = /--tap:\s*(\d+)px/.exec(twBare);
    expect(Number(key?.[1])).toBeGreaterThanOrEqual(Number(tap?.[1]));
  });

  it("shortens the keypad where the screen is short, without crossing the tap floor", () => {
    const short = /@media \(max-height:[^{]+\{[\s\S]*?--key-height:\s*(\d+)px/.exec(componentsBare);
    expect(short, "no short-screen keypad override").not.toBeNull();
    expect(Number(short![1])).toBeGreaterThanOrEqual(44);
  });

  it("keeps every sticky matrix cell opaque", () => {
    // A sticky cell without its own background lets the scrolling content print through it.
    for (const selector of ["matrix thead th", "matrix__category"]) {
      const block = new RegExp(`\\.${selector}[^{]*\\{([^}]*)\\}`).exec(componentsBare);
      expect(block?.[1], `${selector} has no background`).toMatch(/background:/);
    }
  });

  it("gates hover on a real pointer here too", () => {
    const hoverBlocks = componentsBare.match(/@media[^{]*hover[^{]*\{/g) ?? [];
    expect(hoverBlocks.length).toBeGreaterThan(0);
    for (const block of hoverBlocks) expect(block).toContain("pointer: fine");
  });

  it("defines all states for the keypad key", () => {
    // The control that once shipped as a dead grey slab when its states were left to chance.
    expect(componentsBare).toMatch(/\.keypad__key:active/);
  });
});
