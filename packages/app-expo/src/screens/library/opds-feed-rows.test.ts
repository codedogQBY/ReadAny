import type { OpdsFeed } from "@readany/core";
import { describe, expect, it } from "vitest";
import { createOpdsFeedRows } from "./opds-feed-rows";

describe("OPDS virtual feed rows", () => {
  it("flattens a dense catalog into stable rows for lazy rendering", () => {
    const feed: OpdsFeed = {
      title: "Dense shelf",
      navigation: [],
      facets: [],
      groups: [],
      publications: Array.from({ length: 200 }, (_, index) => ({
        id: `book-${index}`,
        title: `Book ${index}`,
        authors: [],
        subjects: [],
        images: [],
        acquisitions: [],
        readingOrder: [],
      })),
    };

    const rows = createOpdsFeedRows(feed);

    expect(rows).toHaveLength(202);
    expect(rows.filter((row) => row.kind === "publication")).toHaveLength(200);
    expect(new Set(rows.map((row) => row.key))).toHaveLength(rows.length);
  });
});
