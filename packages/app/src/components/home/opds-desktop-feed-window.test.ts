import type { OpdsFeed, OpdsPublication } from "@readany/core";
import { describe, expect, it } from "vitest";
import { windowOpdsFeedPublications } from "./opds-desktop-feed-window";

function publication(index: number): OpdsPublication {
  return {
    id: `book-${index}`,
    title: `Book ${index}`,
    authors: [],
    subjects: [],
    images: [{ rel: ["http://opds-spec.org/image"], url: `https://catalog.test/${index}.jpg` }],
    acquisitions: [],
    readingOrder: [],
  };
}

function denseFeed(): OpdsFeed {
  return {
    title: "Dense",
    navigation: [],
    publications: Array.from({ length: 30 }, (_, index) => publication(index)),
    groups: [
      {
        title: "More",
        navigation: [],
        publications: Array.from({ length: 30 }, (_, index) => publication(index + 30)),
        groups: [],
        facets: [],
      },
    ],
    facets: [],
  };
}

describe("desktop OPDS feed window", () => {
  it("keeps a dense feed inside one global rendered publication budget", () => {
    const windowed = windowOpdsFeedPublications(denseFeed(), 18);

    expect(
      windowed.publications.length +
        windowed.groups.reduce((total, group) => total + group.publications.length, 0),
    ).toBe(18);
    expect(windowed.total).toBe(60);
    expect(windowed.hasMore).toBe(true);
  });

  it("continues into grouped publications as the window grows", () => {
    const windowed = windowOpdsFeedPublications(denseFeed(), 35);

    expect(windowed.publications).toHaveLength(30);
    expect(windowed.groups[0]?.publications).toHaveLength(5);
  });
});
