import { describe, expect, it } from "vitest";
import { ReaderExtractionSessions } from "./reader-extraction-sessions";

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe("ReaderExtractionSessions", () => {
  it("keeps A and B paired with their own books when B opens first", async () => {
    const sessions = new ReaderExtractionSessions<{ chapters: string[] }>();
    const a = deferred<{ chapters: string[] }>();
    const b = deferred<{ chapters: string[] }>();

    const openA = sessions.open("A", () => a.promise);
    const openB = sessions.open("B", () => b.promise);
    b.resolve({ chapters: ["B chapter"] });
    await openB;
    a.resolve({ chapters: ["A chapter"] });
    await openA;

    expect(sessions.getBook("A").chapters).toEqual(["A chapter"]);
    expect(sessions.getBook("B").chapters).toEqual(["B chapter"]);
  });

  it("rejects cancelled A after its parser settles without contaminating B", async () => {
    const sessions = new ReaderExtractionSessions<{ chapters: string[] }>();
    const a = deferred<{ chapters: string[] }>();
    const b = deferred<{ chapters: string[] }>();

    const openA = sessions.open("A", () => a.promise);
    sessions.cancel("A");
    const openB = sessions.open("B", () => b.promise);
    b.resolve({ chapters: ["B chapter"] });
    await openB;
    a.resolve({ chapters: ["A chapter"] });

    await expect(openA).rejects.toMatchObject({ name: "AbortError" });
    expect(sessions.getBook("B").chapters).toEqual(["B chapter"]);
    expect(() => sessions.getBook("A")).toThrow(/cancelled|not available/i);
  });
});
