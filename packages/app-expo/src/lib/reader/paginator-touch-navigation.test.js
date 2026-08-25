import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PaginatorTouchTracker,
  SelectionPositionGuard,
  hasActiveTextSelection,
} from "../../../../foliate-js/paginator-touch.js";

const touch = { screenX: 430, screenY: 520 };

describe("paginator touch navigation ownership", () => {
  it("restores the gesture start after movement becomes text selection", () => {
    const tracker = new PaginatorTouchTracker();
    tracker.start(touch, 100, 624);
    tracker.markScrolled();

    expect(
      hasActiveTextSelection([
        {
          doc: {
            getSelection: () => ({ isCollapsed: false, toString: () => "selected text" }),
          },
        },
      ]),
    ).toBe(true);
    expect(tracker.cancel()).toBe(624);
    expect(tracker.state).toBeUndefined();
    expect(tracker.scrolled).toBe(false);
  });

  it("does not request restoration before the paginator moves", () => {
    const tracker = new PaginatorTouchTracker();
    tracker.start(touch, 100, 624);

    expect(tracker.cancel()).toBeNull();
  });

  it("retains the aligned touch start when selection takes ownership before swipe movement", () => {
    const tracker = new PaginatorTouchTracker();
    tracker.start(touch, 100, 1080);

    expect(tracker.takeSelectionStart(1410)).toBe(1080);
    expect(tracker.state).toBeUndefined();
    expect(tracker.scrolled).toBe(false);
  });

  it("falls back to the current position when selection starts without tracked touch state", () => {
    expect(new PaginatorTouchTracker().takeSelectionStart(1080)).toBe(1080);
  });

  it("returns the completed gesture state, including scroll inertia samples", () => {
    const tracker = new PaginatorTouchTracker();
    const state = tracker.start(touch, 100, 624);
    state.dx = 180;
    state.dt = 300;
    state.scrollSamples.push({ velocity: 0.25, time: 250 });
    tracker.markScrolled();

    expect(tracker.finish()).toMatchObject({
      dx: 180,
      dt: 300,
      startPosition: 624,
      scrollSamples: [{ velocity: 0.25, time: 250 }],
    });
    expect(tracker.state).toBeUndefined();
    expect(tracker.scrolled).toBe(false);
  });

  it("ignores collapsed and whitespace-only selections", () => {
    expect(
      hasActiveTextSelection([
        { doc: { getSelection: () => ({ isCollapsed: true, toString: () => "text" }) } },
        { doc: { getSelection: () => ({ isCollapsed: false, toString: () => "   " }) } },
      ]),
    ).toBe(false);
  });
});

describe("native selection position ownership", () => {
  it("restores unowned native selection drift but ignores sub-pixel noise", () => {
    const guard = new SelectionPositionGuard();
    guard.begin(1080);
    guard.begin(1410);

    expect(guard.correctionFor(1410)).toBe(1080);
    expect(guard.correctionFor(1080.4)).toBeNull();
  });

  it("allows explicit edge navigation and rebases protection afterward", () => {
    const guard = new SelectionPositionGuard();
    guard.begin(1080);
    guard.beginNavigation();

    expect(guard.correctionFor(2160)).toBeNull();
    guard.finishNavigation(2160);
    expect(guard.correctionFor(2450)).toBe(2160);
  });

  it("releases position ownership when selection ends", () => {
    const guard = new SelectionPositionGuard();
    guard.begin(1080);
    guard.end();

    expect(guard.active).toBe(false);
    expect(guard.correctionFor(1410)).toBeNull();
  });
});

const paginatorSource = readFileSync(
  new URL("../../../../foliate-js/paginator.js", import.meta.url),
  "utf8",
);

describe("paginator selection cancellation wiring", () => {
  it("guards native selection drift while preserving explicit edge navigation and inertia", () => {
    expect(paginatorSource).toContain(
      "doc.addEventListener('selectstart', () => this.#beginTextSelection())",
    );
    expect(
      paginatorSource.match(
        /if \(this\.#hasActiveTextSelection\(\)\) \{\s*this\.#beginTextSelection\(\)\s*return\s*\}/g,
      ),
    ).toHaveLength(3);
    expect(paginatorSource).toMatch(
      /this\.#container\.addEventListener\('scroll', \(\) => \{\s*const restorePosition = this\.#selectionPosition\.correctionFor\(this\.containerPosition\)/,
    );
    expect(paginatorSource).toMatch(
      /#beginTextSelection\(\) \{\s*if \(this\.scrolled\) \{\s*this\.#cancelTouchNavigation\(\)\s*return/,
    );
    expect(paginatorSource).toContain("this.#selectionPosition.end()");
    expect(paginatorSource).toMatch(
      /this\.#selectionPosition\.beginNavigation\(\)\s*try \{\s*if \(direction === 'backward'\) await this\.prev\(\)\s*else await this\.next\(\)[\s\S]*?finally \{\s*this\.#selectionPosition\.finishNavigation\(this\.containerPosition\)/,
    );
    expect(paginatorSource).toContain(
      "if (!this.#navigationLocked) this.#startScrollInertia(state)",
    );
  });
});
