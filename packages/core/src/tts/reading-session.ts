export type TTSReadingMode = "page" | "selection";

export interface TTSReadingSegment {
  text: string;
  cfi: string | null;
}

export interface TTSReadingSnapshot {
  mode: TTSReadingMode;
  continuous: boolean;
  previous: TTSReadingSegment[];
  current: TTSReadingSegment[];
  future: TTSReadingSegment[];
}

export type TTSReadingJump =
  | { kind: "current"; index: number }
  | { kind: "outside"; target: TTSReadingSegment; snapshot: TTSReadingSnapshot }
  | { kind: "none" };

function segmentIdentity(segment: TTSReadingSegment): string {
  return `${segment.cfi || ""}::${segment.text.replace(/\s+/g, " ").trim()}`;
}

function normalizeSegments(segments: TTSReadingSegment[]): TTSReadingSegment[] {
  const seen = new Set<string>();
  const result: TTSReadingSegment[] = [];
  for (const segment of segments) {
    const text = segment.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const normalized = { text, cfi: segment.cfi || null };
    // Selection segments do not have a CFI. Repeated sentences are valid
    // there, so only use identity-based deduplication when a stable CFI exists.
    if (!normalized.cfi) {
      result.push(normalized);
      continue;
    }
    const identity = segmentIdentity(normalized);
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(normalized);
  }
  return result;
}

export class TTSReadingSession {
  private state: TTSReadingSnapshot = {
    mode: "page",
    continuous: true,
    previous: [],
    current: [],
    future: [],
  };

  snapshot(): TTSReadingSnapshot {
    return {
      mode: this.state.mode,
      continuous: this.state.continuous,
      previous: [...this.state.previous],
      current: [...this.state.current],
      future: [...this.state.future],
    };
  }

  reset(): TTSReadingSnapshot {
    this.state = {
      mode: "page",
      continuous: true,
      previous: [],
      current: [],
      future: [],
    };
    return this.snapshot();
  }

  start(
    mode: TTSReadingMode,
    current: TTSReadingSegment[],
    continuous = mode === "page",
  ): TTSReadingSnapshot {
    this.state = {
      mode,
      continuous: mode === "page" && continuous,
      previous: [],
      current: normalizeSegments(current),
      future: [],
    };
    return this.snapshot();
  }

  replaceCurrent(current: TTSReadingSegment[]): TTSReadingSnapshot {
    this.state = {
      ...this.state,
      current: normalizeSegments(current),
      future: [],
    };
    return this.snapshot();
  }

  setContinuous(continuous: boolean): TTSReadingSnapshot {
    this.state = {
      ...this.state,
      continuous: this.state.mode === "page" && continuous,
    };
    return this.snapshot();
  }

  setContext(previous: TTSReadingSegment[], future: TTSReadingSegment[]): TTSReadingSnapshot {
    this.state = {
      ...this.state,
      previous: normalizeSegments(previous),
      future: normalizeSegments(future),
    };
    return this.snapshot();
  }

  appendPrevious(segments: TTSReadingSegment[]): TTSReadingSnapshot {
    return this.setContext([...segments, ...this.state.previous], this.state.future);
  }

  appendFuture(segments: TTSReadingSegment[]): TTSReadingSnapshot {
    return this.setContext(this.state.previous, [...this.state.future, ...segments]);
  }

  clearFuture(): TTSReadingSnapshot {
    return this.setContext(this.state.previous, []);
  }

  jump(offsetFromCurrent: number): TTSReadingJump {
    if (!Number.isInteger(offsetFromCurrent)) return { kind: "none" };
    if (offsetFromCurrent >= 0 && offsetFromCurrent < this.state.current.length) {
      return { kind: "current", index: offsetFromCurrent };
    }

    if (offsetFromCurrent < 0) {
      const previousIndex = this.state.previous.length + offsetFromCurrent;
      if (previousIndex < 0 || previousIndex >= this.state.previous.length) {
        return { kind: "none" };
      }
      const current = [
        ...this.state.previous.slice(previousIndex),
        ...this.state.current,
        ...this.state.future,
      ];
      const target = current[0];
      if (!target) return { kind: "none" };
      this.state = {
        ...this.state,
        previous: this.state.previous.slice(0, previousIndex),
        current: normalizeSegments(current),
        future: [],
      };
      return { kind: "outside", target, snapshot: this.snapshot() };
    }

    const futureIndex = offsetFromCurrent - this.state.current.length;
    if (futureIndex < 0 || futureIndex >= this.state.future.length) {
      return { kind: "none" };
    }
    const current = this.state.future.slice(futureIndex);
    const target = current[0];
    if (!target) return { kind: "none" };
    const consumed = [...this.state.current, ...this.state.future.slice(0, futureIndex)];
    this.state = {
      ...this.state,
      previous: normalizeSegments([...this.state.previous, ...consumed]),
      current: normalizeSegments(current),
      future: [],
    };
    return { kind: "outside", target, snapshot: this.snapshot() };
  }
}
