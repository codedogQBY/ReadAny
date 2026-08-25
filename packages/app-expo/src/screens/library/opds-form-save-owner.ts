export interface OpdsFormSaveToken {
  readonly saveId: number;
  readonly openGeneration: number;
}

export function createOpdsFormSaveOwner() {
  let openGeneration = 0;
  let saveId = 0;
  let open = false;
  let active: OpdsFormSaveToken | undefined;

  return {
    open(): number {
      open = true;
      openGeneration += 1;
      return openGeneration;
    },
    close(): void {
      open = false;
    },
    start(generation: number): OpdsFormSaveToken | undefined {
      if (active || !open || generation !== openGeneration) return undefined;
      active = { saveId: ++saveId, openGeneration: generation };
      return active;
    },
    finish(token: OpdsFormSaveToken): "current" | "stale" | "ignored" {
      if (active?.saveId !== token.saveId) return "ignored";
      active = undefined;
      return open && token.openGeneration === openGeneration ? "current" : "stale";
    },
    isSavingCurrent(generation: number): boolean {
      return active?.openGeneration === generation && open && generation === openGeneration;
    },
    hasActiveSave(): boolean {
      return active !== undefined;
    },
  };
}
