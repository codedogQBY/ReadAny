import { describe, expect, it, vi } from "vitest";
import { createScrollToBottomController } from "./scroll-to-bottom-controller";

describe("scroll-to-bottom controller", () => {
  it("keeps converging when content grows after an estimated bottom", () => {
    const ticks: Array<() => void> = [];
    const scrollToEnd = vi.fn();
    const cancelSchedule = vi.fn();
    const controller = createScrollToBottomController({
      scrollToEnd,
      schedule: (callback) => {
        ticks.push(callback);
        return 7;
      },
      cancelSchedule,
      bottomThreshold: 80,
      maxAttempts: 10,
    });

    controller.request();
    expect(scrollToEnd).toHaveBeenCalledTimes(1);
    expect(controller.isPending()).toBe(true);

    controller.observeDistance(79);
    expect(controller.isPending()).toBe(true);

    controller.contentSizeChanged();
    expect(scrollToEnd).toHaveBeenCalledTimes(2);
    controller.observeDistance(81);
    ticks[0]();
    expect(scrollToEnd).toHaveBeenCalledTimes(3);
    controller.observeDistance(79);

    ticks[0]();
    expect(controller.isPending()).toBe(true);
    ticks[0]();
    expect(controller.isPending()).toBe(false);
    expect(cancelSchedule).toHaveBeenCalledWith(7);
  });

  it("does not spend the timer attempt budget on content-size events", () => {
    let tick: (() => void) | undefined;
    const scrollToEnd = vi.fn();
    const onExhausted = vi.fn();
    const controller = createScrollToBottomController({
      scrollToEnd,
      schedule: (callback) => {
        tick = callback;
        return "timer";
      },
      cancelSchedule: vi.fn(),
      maxAttempts: 2,
      onExhausted,
    });

    controller.request();
    controller.contentSizeChanged();
    controller.contentSizeChanged();
    controller.contentSizeChanged();
    expect(scrollToEnd).toHaveBeenCalledTimes(4);

    tick?.();
    expect(scrollToEnd).toHaveBeenCalledTimes(5);
    expect(onExhausted).not.toHaveBeenCalled();
    tick?.();
    expect(onExhausted).toHaveBeenCalledTimes(1);
  });

  it("stops at the attempt bound and reports exhaustion once", () => {
    let tick: (() => void) | undefined;
    const scrollToEnd = vi.fn();
    const onExhausted = vi.fn();
    const controller = createScrollToBottomController({
      scrollToEnd,
      schedule: (callback) => {
        tick = callback;
        return "timer";
      },
      cancelSchedule: vi.fn(),
      bottomThreshold: 80,
      maxAttempts: 2,
      onExhausted,
    });

    controller.request();
    tick?.();
    tick?.();
    tick?.();

    expect(scrollToEnd).toHaveBeenCalledTimes(2);
    expect(controller.isPending()).toBe(false);
    expect(onExhausted).toHaveBeenCalledTimes(1);
  });
});
