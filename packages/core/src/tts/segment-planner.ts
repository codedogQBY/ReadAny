export interface Segment {
  index: number;
  text: string;
  startOffset: number;
  endOffset: number;
  cfi?: string;
  chapterIndex?: number;
}

export interface SegmentPosition {
  cfi?: string;
  offset?: number;
}

export interface SegmentPlannerOptions {
  maxCharacters?: number;
}

export class SegmentPlanner {
  constructor(private readonly options: SegmentPlannerOptions = {}) {}

  plan(text: string | string[], options: SegmentPlannerOptions = {}): Segment[] {
    const maxCharacters = options.maxCharacters ?? this.options.maxCharacters ?? 500;
    if (Array.isArray(text)) {
      return text
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value, index) => ({
          index,
          text: value,
          startOffset: text.slice(0, index).join(" ").length,
          endOffset: text.slice(0, index + 1).join(" ").length,
        }));
    }
    const source = text.replace(/\s+/g, " ").trim();
    if (!source) return [];
    const result: Segment[] = [];
    let offset = 0;
    for (const paragraph of source.split(/(?<=[.!?。！？；;])\s+/u)) {
      let start = 0;
      while (start < paragraph.length) {
        const end = Math.min(start + maxCharacters, paragraph.length);
        const value = paragraph.slice(start, end).trim();
        if (value) {
          const startOffset = offset + start;
          result.push({
            index: result.length,
            text: value,
            startOffset,
            endOffset: startOffset + value.length,
          });
        }
        start = end;
      }
      offset += paragraph.length + 1;
    }
    return result;
  }

  findStart(segments: Segment[], position: SegmentPosition): number {
    if (!segments.length) return -1;
    if (position.cfi) {
      const match = segments.find((segment) => segment.cfi === position.cfi);
      if (match) return match.index;
    }
    if (position.offset != null) {
      const offset = position.offset;
      const match = segments.find((segment) => offset < segment.endOffset);
      if (match) return match.index;
    }
    return 0;
  }
}
