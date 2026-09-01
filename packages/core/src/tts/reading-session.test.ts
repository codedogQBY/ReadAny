import { describe, expect, it } from "vitest";
import { TTSReadingSession } from "./reading-session";

const segment = (text: string, cfi = text) => ({ text, cfi });

describe("TTSReadingSession", () => {
  it("normalizes and deduplicates the active queue", () => {
    const session = new TTSReadingSession();
    const snapshot = session.start("page", [
      segment("  one  ", "one"),
      segment("one", "one"),
      segment("two"),
    ]);

    expect(snapshot.current).toEqual([segment("one"), segment("two")]);
    expect(snapshot.previous).toEqual([]);
    expect(snapshot.future).toEqual([]);
  });

  it("keeps selection sessions non-continuous", () => {
    const session = new TTSReadingSession();
    expect(session.start("selection", [segment("selected")], true).continuous).toBe(false);
  });

  it("keeps repeated selection sentences", () => {
    const session = new TTSReadingSession();
    const snapshot = session.start("selection", [segment("repeat", ""), segment("repeat", "")]);
    expect(snapshot.current.map((item) => item.text)).toEqual(["repeat", "repeat"]);
  });

  it("moves a previous lyric into the active queue", () => {
    const session = new TTSReadingSession();
    session.start("page", [segment("current")]);
    session.setContext([segment("previous")], [segment("future")]);

    const jump = session.jump(-1);
    expect(jump.kind).toBe("outside");
    expect(session.snapshot().current.map((item) => item.text)).toEqual([
      "previous",
      "current",
      "future",
    ]);
    expect(session.snapshot().previous).toEqual([]);
  });

  it("moves a future lyric to the active queue without replaying consumed text", () => {
    const session = new TTSReadingSession();
    session.start("page", [segment("current-1"), segment("current-2")]);
    session.setContext([segment("previous")], [segment("future-1"), segment("future-2")]);

    const jump = session.jump(3);
    expect(jump.kind).toBe("outside");
    expect(session.snapshot().current.map((item) => item.text)).toEqual(["future-2"]);
    expect(session.snapshot().previous.map((item) => item.text)).toEqual([
      "previous",
      "current-1",
      "current-2",
      "future-1",
    ]);
  });
});
