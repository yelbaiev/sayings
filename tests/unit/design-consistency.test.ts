import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Cross-cutting consistency: the same function must look and behave the same everywhere in the app.
 *
 * Written after a round of feedback that was really one observation four times over. The receipt
 * viewer had its dismiss on the left where every dialog puts it on the right, gave that dismiss a
 * scrim the others do not have, let the form underneath show through its header, and framed its image
 * with square corners against a rounded panel. None of those were decisions. They were the cost of
 * having built a second dialog instead of reusing the one that existed — and no reviewer would catch
 * that by reading either file, because each is internally coherent.
 *
 * The rules below are the ones from Fluent 2's structure that can actually be checked by machine.
 * Fluent's own code is deliberately not a dependency (docs/decisions/0005-design-tokens.md); what
 * transfers is the discipline:
 *
 *   - one set of tokens, in layers, and nothing outside them
 *   - one primitive per job, so a job cannot be done two ways
 *   - every control defines all of its states, not just rest
 *   - a surface is opaque or it is a scrim; there is no third thing
 *
 * What this file cannot check is whether the result looks right. That is the gallery at /design.
 */

const css = readFileSync(new URL("../../src/styles/components.css", import.meta.url), "utf8");
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "");
const bare = strip(css);

/** Every .tsx under src, so a rule cannot be dodged by putting the code in a new file. */
function sources(dir = new URL("../../src/", import.meta.url)): { path: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
    if (entry.isDirectory()) return sources(child);
    if (!entry.name.endsWith(".tsx")) return [];
    return [{ path: entry.name, text: readFileSync(child, "utf8") }];
  });
}

const files = sources();
const rule = (selector: string) => {
  const match = new RegExp(
    `(?:^|\\})\\s*${selector.replace(/\./g, "\\.")}\\s*\\{([^}]*)\\}`,
    "m",
  ).exec(bare);
  return match?.[1] ?? "";
};

describe("one primitive per job", () => {
  it("declares a dialog in exactly one place", () => {
    /*
     * The rule the receipt viewer broke. A second dialog implementation is a second set of answers
     * to where the dismiss goes, what closes it and how it looks on a desktop — and those answers
     * will not match, because nothing makes them. Post-vaul the tell is using the primitives'
     * content components directly: everything must go through the Sheet wrapper instead.
     */
    const declaring = files
      .filter((f) => /<(?:DialogContent|DrawerContent)[\s>]/.test(f.text))
      .map((f) => f.path)
      .sort();
    // Only the Sheet wrapper. The vendored primitives *define* these components but never render
    // them — their JSX uses DialogPrimitive.Content — so any second entry here is a second dialog.
    expect(declaring).toEqual(["index.tsx"]);
  });

  it("renders the dismiss control in exactly one place", () => {
    // If CloseIcon appears outside the dialog primitive, something has grown its own way out —
    // and its own idea of which side that is on.
    const using = files
      .filter((f) => /<CloseIcon/.test(f.text))
      .map((f) => f.path)
      .sort();
    expect(using).toEqual(["index.tsx"]);
  });

  it("keeps the dismiss on the trailing edge by construction, not by repetition", () => {
    // The title pushes everything after it to the end, so a dialog cannot accidentally put its
    // dismiss first — which is exactly how the viewer ended up with it on the left. The property
    // moved from a CSS rule to the wrapper's own markup with the vaul migration.
    const sheet = files.find((f) => f.path === "index.tsx")!;
    expect(sheet.text).toMatch(/titleControl \?\? \(\s*<h2 className="mr-auto/);
  });

  it("routes every button through the primitive", () => {
    // The ratchet reached zero with the entry-screen sweep, and zero is where it stays: a raw
    // <button className="btn ..."> cannot define its own states, which is how a four-row key once
    // ended up as a grey slab when disabled.
    const raw = files.flatMap((f) => f.text.match(/className="btn\b[^"]*"/g) ?? []);
    expect(raw).toEqual([]);
  });
});

describe("a label labels a field, and a group labels a group", () => {
  it("never wraps a Field around controls that are buttons", () => {
    /*
     * `Field` renders a `<label>`, and per the HTML spec a `<label>` labels the first *labelable*
     * descendant — a list that includes `<button>`. So a Field wrapping a row of chips hands the
     * whole field's label to the first chip as its accessible name, and leaves the group unnamed:
     * a screen reader announced the first currency as "Currencies you use AED AUD AZN …".
     *
     * Found by a test asking for a button named UAH and not finding one, in five places at once —
     * the currency chips, the theme switch, and the icon and colour pickers in two editors. Every
     * one of them looked right, which is why this is a rule and not a review note. `FieldGroup` is
     * the same markup with a `role="group"`, so nothing changes on screen.
     */
    /*
     * The check is on the *first* labelable descendant, not on the presence of a button anywhere —
     * which is what the spec actually says, and the difference matters. The rate field holds an input
     * and a reset button, and there the label belongs to the input; a coarser rule flagged it, and
     * loosening the rule to pass would have thrown away the five real findings with it.
     */
    const LABELABLE = /<(input|select|textarea|button|Chip|Segmented|IconButton|Button)[\s>]/;
    const BUTTONS = new Set(["button", "Chip", "Segmented", "IconButton", "Button"]);

    const offenders: string[] = [];
    for (const file of files) {
      let index = 0;
      while (true) {
        const start = file.text.indexOf("<Field", index);
        if (start === -1) break;
        // `<FieldGroup` also starts with `<Field`; only the exact tag renders a label.
        const isField = /^<Field[\s>]/.test(file.text.slice(start, start + 8));
        const end = file.text.indexOf("</Field>", start);
        if (isField && end !== -1) {
          const first = LABELABLE.exec(file.text.slice(start, end));
          if (first && BUTTONS.has(first[1]!)) offenders.push(file.path);
        }
        index = start + 6;
      }
    }
    expect([...new Set(offenders)], `Field wrapping buttons in: ${offenders.join(", ")}`).toEqual([]);
  });
});

describe("surfaces are opaque or they are scrims", () => {
  it("gives every full-viewport layer a background", () => {
    /*
     * The bleed-through, stated as a rule. A layer covering the viewport either paints something or
     * it is a scrim; a layer that is 88% of a colour lets the form underneath print through its own
     * header, which is what happened.
     */
    const offenders: string[] = [];
    for (const match of bare.matchAll(/([.\w-]+)\s*\{([^}]*)\}/g)) {
      const [, selector, body] = match;
      if (!body || !/position:\s*fixed/.test(body) || !/inset:\s*0/.test(body)) continue;
      if (/backdrop/.test(selector ?? "")) continue;
      if (!/background/.test(body)) offenders.push(selector ?? "?");
    }
    expect(offenders, `full-screen layers with no background: ${offenders.join(", ")}`).toEqual([]);
  });

  it("keeps a sticky cell opaque, or the content scrolls through it", () => {
    // Every sticky cell in the reports matrix needs its own fill for the same reason.
    for (const selector of [".matrix__corner", ".matrix__category"]) {
      const body = rule(selector) + rule(".matrix thead th");
      expect(body, selector).toMatch(/background:/);
    }
  });
});

describe("every control defines all its states", () => {
  /*
   * Fluent names rest, hover, pressed, disabled and selected explicitly, and the reason is the bug
   * this codebase produced twice: a control with only a rest style falls back to whatever its base
   * rule happens to give, which for a disabled four-row key was a flat grey fill.
   */
  /*
   * Down from six selectors to one: every other control moved into cva variants, where its states
   * are pinned by the primitives' own tests. The keypad key is the control that stays CSS — and the
   * one that shipped as a dead grey slab when its states were left to chance.
   */
  const interactive = [".keypad__key"];

  it("defines a pressed or disabled state for each", () => {
    for (const selector of interactive) {
      const escaped = selector.replace(".", "\\.");
      expect(bare, `${selector} has neither :active nor :disabled`).toMatch(
        new RegExp(`${escaped}[^{]*:(active|disabled)`),
      );
    }
  });

  it("gates hover on a real pointer, so it does not stick on a touch device", () => {
    // `hover: hover` alone matches some phones, which then keep the state on the last thing tapped.
    const hoverBlocks = bare.match(/@media[^{]*hover[^{]*\{/g) ?? [];
    expect(hoverBlocks.length).toBeGreaterThan(0);
    for (const block of hoverBlocks) expect(block).toContain("pointer: fine");
  });
});

describe("nothing outside the token file invents a value", () => {
  it("uses no raw colour", () => {
    // A mask is the one exception: it works on luminance, so black and transparent are the values,
    // not a theme.
    const raw = [...bare.matchAll(/^\s*(?!.*mask-image)([\w-]+):\s*([^;]*#[0-9a-fA-F]{3,8}[^;]*);/gm)]
      .map(([, prop, value]) => `${prop}: ${value}`);
    expect(raw, `raw colours: ${raw.join(" | ")}`).toEqual([]);
  });

  it("uses no raw corner radius", () => {
    const raw = [...bare.matchAll(/^\s*border-radius:\s*([^;]+);/gm)]
      .map(([, value]) => value!)
      // calc() off a token is still the token's scale.
      .filter((value) => /\d+px/.test(value) && !value.includes("var(--radius"));
    expect(raw, `raw radii: ${raw.join(" | ")}`).toEqual([]);
  });

  it("keeps the closed-palette promise inside component CSS too", () => {
    // components.css must draw from the same theme variables as everything else; a hex here would
    // be the first raw colour in the codebase.
    expect(bare).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe("the entry form fits above the keypad", () => {
  it("gives the entry form no control that changes its height", () => {
    /*
     * The structural half; the metric half (key height vs tap floor, the short-screen override)
     * lives in tokens.test.ts beside the theme. Pickers open in a sheet over the form; if one ever
     * expands *inside* it again, the form has two heights and only the smaller was checked against
     * the keypad. The amount's own aria-expanded is exempt by name: it describes the keypad in the
     * footer, which the form is measured against, not something growing inside it.
     */
    const entry = files.filter((f) => f.path.startsWith("Entry") || f.path === "PickerSheets.tsx");
    expect(entry.length).toBeGreaterThan(0);
    for (const file of entry) {
      const expansions = (file.text.match(/aria-expanded=\{(\w+)\}/g) ?? []).filter(
        (match) => !match.includes("keypadOpen"),
      );
      expect(expansions, `${file.path} expands a field in place`).toEqual([]);
    }
  });
});

describe("the sheet that has to share the screen", () => {
  it("gives a filled sheet the whole viewport, and only in the drawer branch", () => {
    /*
     * The entry sheet with its keypad up needs every pixel; `fill` hands the drawer the screen.
     * Structural since the vaul migration: the Dialog branch never reads `fill` at all, so a
     * desktop dialog cannot become a full-viewport panel by accident — that is checked here as
     * "fill appears exactly once, and with the full-height classes".
     */
    const sheet = files.find((f) => f.path === "index.tsx")!;
    expect(sheet.text).toContain('"h-dvh pt-[env(safe-area-inset-top)]"');
    // Same-variant overrides, or the vendored drawer's own mt-24/max-h-[80vh] win and "full
    // screen" quietly stops at 80% — which is exactly how it shipped once.
    expect(sheet.text).toContain("data-[vaul-drawer-direction=bottom]:max-h-none");
    expect(sheet.text).toContain("data-[vaul-drawer-direction=bottom]:mt-0");
    const uses = sheet.text.match(/\bfill &&/g) ?? [];
    expect(uses).toHaveLength(1);
  });
});

describe("inline styles only ever decrease", () => {
  it("holds the line at 15", () => {
    /*
     * The migration converts inline styles to utilities screen by screen; the ratchet makes the
     * direction one-way. The ~33 genuinely dynamic ones — drag offsets, data-driven colours,
     * progress widths — will remain at the end, each with an eslint disable naming its reason,
     * and the ceiling drops as the sweep proceeds.
     */
    const count = files.reduce(
      (sum, file) => sum + (file.text.match(/style=\{\{/g)?.length ?? 0),
      0,
    );
    expect(count, "inline styles may fall, never rise").toBeLessThanOrEqual(15);
  });
});
