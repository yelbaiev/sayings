import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button, IconButton } from "~/ui/Button";
import { Cluster, Stack } from "~/ui/layout";

/**
 * Wiring tests for the primitives.
 *
 * What this layer is for: given these props, does the right thing render, and is the handler actually
 * connected. Every bug it would have caught was of that shape — a control rendered before its data
 * arrived, a handler never passed, a disabled condition inverted.
 *
 * What it is explicitly not for: gestures and appearance. jsdom has no pointer capture and no layout,
 * so a test of either passes whether or not the bug is present. See tests/dom/setup.ts.
 */

describe("Button", () => {
  it("is a button, not a div, without being told", () => {
    // A div with an onClick is not keyboard-reachable and has no implicit role. The primitive sets
    // type="button" too, so it cannot accidentally submit a form.
    render(<Button onClick={() => undefined}>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("type", "button");
  });

  it("marks itself as the button slot and varies by variant", () => {
    /*
     * Post-shadcn, appearance lives in utility classes whose exact spelling is cva's business, not
     * this test's — asserting on "btn--danger" was asserting on orthography. What is contractual:
     * the slot marker (how anything else finds a button), and that variants actually differ.
     */
    render(
      <>
        <Button variant="danger" size="sm">
          Delete
        </Button>
        <Button>Ok</Button>
      </>,
    );
    const danger = screen.getByRole("button", { name: "Delete" });
    const plain = screen.getByRole("button", { name: "Ok" });
    expect(danger.getAttribute("data-slot")).toBe("button");
    expect(danger.className).not.toBe(plain.className);
    // The house rule, checkable in class terms: danger text, never a danger *fill* at rest.
    // Tinted hover states (bg-destructive/10) are fine; the bare token is the violation.
    expect(danger.className).toContain("text-destructive");
    expect(danger.className.split(/\s+/)).not.toContain("bg-destructive");
  });

  it("keeps every size at or above the tap-target floor", () => {
    // 44px is a tested invariant, not a preference; shadcn's stock h-9 would quietly lose it.
    render(
      <>
        <Button size="sm">A</Button>
        <Button size="md">B</Button>
      </>,
    );
    for (const button of screen.getAllByRole("button")) {
      expect(button.className).toContain("min-h-11");
    }
  });

  it("does not fire while disabled", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("takes a layout class without losing its own", () => {
    render(<Button layoutClassName="ml-auto">Delete</Button>);
    const cls = screen.getByRole("button").className;
    expect(cls).toContain("inline-flex");
    expect(cls).toContain("ml-auto");
  });
});

describe("IconButton", () => {
  it("always has an accessible name", () => {
    /*
     * The reason `label` is required rather than optional. An icon-only button with no name is
     * invisible to a screen reader, and there is no way to notice that by looking at it — which is
     * exactly the class of thing that survives review.
     */
    render(
      <IconButton label="Close">
        <svg />
      </IconButton>,
    );
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("uses the label as its tooltip too, so a mouse user can find out as well", () => {
    render(
      <IconButton label="Move up">
        <span>↑</span>
      </IconButton>,
    );
    expect(screen.getByRole("button", { name: "Move up" }).getAttribute("title")).toBe("Move up");
  });

  it("fires when clicked, and not when disabled", () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <IconButton label="Close" onClick={onClick}>
        <svg />
      </IconButton>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <IconButton label="Close" onClick={onClick} disabled>
        <svg />
      </IconButton>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is square by default and wide when asked", () => {
    // Square means the width is pinned to the tap floor; wide lets the content size it. The two
    // must actually differ, or `shape` is a prop that does nothing.
    const { rerender } = render(
      <IconButton label="a">
        <svg />
      </IconButton>,
    );
    const square = screen.getByRole("button").className;
    expect(square).toContain("min-w-11");

    rerender(
      <IconButton label="a" shape="wide">
        <svg />
      </IconButton>,
    );
    expect(screen.getByRole("button").className).not.toContain("min-w-11");
  });
});

describe("layout primitives", () => {
  it("turns a gap into a scale class, never a pixel value", () => {
    // The whole reason these exist. A caller cannot express 6px or 10px here, which is how those
    // values got into the stylesheet 48 times before the scale had names for them.
    render(
      <Stack gap={3}>
        <span>a</span>
      </Stack>,
    );
    const el = screen.getByText("a").parentElement!;
    expect(el.className).toContain("gap-3");
    expect(el.getAttribute("style")).toBeNull();
  });

  it("always has a gap, so children never touch by accident", () => {
    // Post-shadcn the default is explicit rather than inherited from a .stack rule that no longer
    // exists — omitting it entirely would silently zero every un-gapped Stack in the app.
    render(
      <Cluster>
        <span>b</span>
      </Cluster>,
    );
    expect(screen.getByText("b").parentElement!.className).toMatch(/\bgap-\d\b/);
  });

  it("keeps a placement class alongside the gap", () => {
    render(
      <Stack gap={2} className="col-span-2">
        <span>c</span>
      </Stack>,
    );
    const cls = screen.getByText("c").parentElement!.className;
    expect(cls).toContain("gap-2");
    expect(cls).toContain("col-span-2");
  });
});
