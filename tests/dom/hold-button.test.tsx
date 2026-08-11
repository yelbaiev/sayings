import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HoldButton } from "~/ui/HoldButton";
import { renderInApp } from "./harness";

/**
 * Hold-to-delete: the structural defence against accidental deletion.
 *
 * The property under test is the whole point — a tap must do *nothing destructive*. The undo toast
 * remains as the second net, but a net you have to notice is weaker than an accident that cannot
 * happen. Timers are faked, because the contract is temporal: 900ms of sustained hold fires, one
 * millisecond less does not.
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function renderHold(onConfirm: () => void) {
  return renderInApp(<HoldButton onConfirm={onConfirm}>Удалить</HoldButton>);
}

describe("HoldButton", () => {
  it("does nothing on a tap — the accident cannot happen", () => {
    const onConfirm = vi.fn();
    renderHold(onConfirm);
    const button = screen.getByRole("button");

    fireEvent.pointerDown(button);
    act(() => vi.advanceTimersByTime(200));
    fireEvent.pointerUp(button);
    act(() => vi.advanceTimersByTime(2000));

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("teaches the gesture instead of silently ignoring the tap", () => {
    renderHold(vi.fn());
    const button = screen.getByRole("button");

    fireEvent.pointerDown(button);
    fireEvent.pointerUp(button);
    expect(button.textContent).toContain("Удерживайте");

    // And the hint retires by itself, so the label is not permanently replaced.
    act(() => vi.advanceTimersByTime(1700));
    expect(button.textContent).toContain("Удалить");
  });

  it("fires after a sustained hold", () => {
    const onConfirm = vi.fn();
    renderHold(onConfirm);
    const button = screen.getByRole("button");

    fireEvent.pointerDown(button);
    act(() => vi.advanceTimersByTime(899));
    expect(onConfirm).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("cancels when the finger leaves the button", () => {
    // Sliding off is how people abort a press they regret — it must count as a no.
    const onConfirm = vi.fn();
    renderHold(onConfirm);
    const button = screen.getByRole("button");

    fireEvent.pointerDown(button);
    act(() => vi.advanceTimersByTime(500));
    fireEvent.pointerLeave(button);
    act(() => vi.advanceTimersByTime(2000));

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("gives the keyboard a two-press confirm, since it cannot hold", () => {
    const onConfirm = vi.fn();
    renderHold(onConfirm);
    const button = screen.getByRole("button");

    fireEvent.keyDown(button, { key: "Enter" });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(button.textContent).toContain("ещё раз");

    fireEvent.keyDown(button, { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("disarms the keyboard confirm if the second press never comes", () => {
    const onConfirm = vi.fn();
    renderHold(onConfirm);
    const button = screen.getByRole("button");

    fireEvent.keyDown(button, { key: "Enter" });
    act(() => vi.advanceTimersByTime(3100));
    fireEvent.keyDown(button, { key: "Enter" });

    // That second press re-armed rather than fired: the window had closed.
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
