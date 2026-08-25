import { describe, expect, it } from "vitest";
import { createOpdsFormSaveOwner } from "./opds-form-save-owner";

describe("mobile OPDS form save ownership", () => {
  it("serializes deferred add and update saves in one open generation", () => {
    const owner = createOpdsFormSaveOwner();
    const generation = owner.open();
    const first = owner.start(generation);

    expect(first).toBeDefined();
    expect(owner.isSavingCurrent(generation)).toBe(true);
    expect(owner.start(generation)).toBeUndefined();
    expect(owner.finish(first as never)).toBe("current");

    const second = owner.start(generation);
    expect(second).toBeDefined();
    expect(owner.finish(second as never)).toBe("current");
  });

  it("treats completion after forced close and reopen as background-only", () => {
    const owner = createOpdsFormSaveOwner();
    const firstGeneration = owner.open();
    const first = owner.start(firstGeneration);
    owner.close();
    const secondGeneration = owner.open();

    expect(owner.isSavingCurrent(secondGeneration)).toBe(false);
    expect(owner.hasActiveSave()).toBe(true);
    expect(owner.finish(first as never)).toBe("stale");
    expect(owner.hasActiveSave()).toBe(false);
    expect(owner.start(secondGeneration)).toBeDefined();
  });
});
