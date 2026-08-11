import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PullToRefresh } from "~/ui/PullToRefresh";

/**
 * The browser half of pull-to-refresh: what the state machine cannot see. Which touches are
 * allowed to start a pull at all — and that an open sheet stands the whole gesture down.
 */

function pull(el: HTMLElement, distance: number) {
  fireEvent.touchStart(el, { touches: [{ clientX: 100, clientY: 100 }] });
  fireEvent.touchMove(el, { touches: [{ clientX: 100, clientY: 100 + distance }] });
  fireEvent.touchEnd(el, { touches: [] });
}

afterEach(() => {
  document.body.innerHTML = "";
  window.scrollY = 0;
});

describe("PullToRefresh", () => {
  it("refreshes on a long-enough downward pull from the top", async () => {
    const onRefresh = vi.fn(() => Promise.resolve());
    render(
      <PullToRefresh onRefresh={onRefresh}>
        <p>content</p>
      </PullToRefresh>,
    );

    await act(async () => {
      pull(screen.getByText("content"), 200);
    });
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("does nothing for a short pull", async () => {
    const onRefresh = vi.fn(() => Promise.resolve());
    render(
      <PullToRefresh onRefresh={onRefresh}>
        <p>content</p>
      </PullToRefresh>,
    );

    await act(async () => {
      pull(screen.getByText("content"), 40);
    });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("does nothing when the page is scrolled — a downward finger means scroll up", async () => {
    const onRefresh = vi.fn(() => Promise.resolve());
    render(
      <PullToRefresh onRefresh={onRefresh}>
        <p>content</p>
      </PullToRefresh>,
    );

    window.scrollY = 300;
    await act(async () => {
      pull(screen.getByText("content"), 200);
    });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("stands down while a sheet is open", async () => {
    const onRefresh = vi.fn(() => Promise.resolve());
    render(
      <PullToRefresh onRefresh={onRefresh}>
        <p>content</p>
      </PullToRefresh>,
    );

    const sheet = document.createElement("div");
    sheet.setAttribute("role", "dialog");
    document.body.appendChild(sheet);

    await act(async () => {
      pull(screen.getByText("content"), 200);
    });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("ignores a horizontal swipe, which belongs to the rows", async () => {
    const onRefresh = vi.fn(() => Promise.resolve());
    render(
      <PullToRefresh onRefresh={onRefresh}>
        <p>content</p>
      </PullToRefresh>,
    );

    const el = screen.getByText("content");
    await act(async () => {
      fireEvent.touchStart(el, { touches: [{ clientX: 100, clientY: 100 }] });
      fireEvent.touchMove(el, { touches: [{ clientX: 300, clientY: 180 }] });
      fireEvent.touchEnd(el, { touches: [] });
    });
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
