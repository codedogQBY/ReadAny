import type { OpdsFeed, OpdsPublication } from "@readany/core";

export type OpdsFeedRow =
  | { kind: "intro"; key: string; feed: OpdsFeed }
  | { kind: "section"; key: string; title: string }
  | { kind: "link"; key: string; title: string; url: string; icon: boolean }
  | {
      kind: "publication";
      key: string;
      publication: OpdsPublication;
      keyPrefix: string;
    }
  | { kind: "empty"; key: string }
  | { kind: "pagination"; key: string; previousUrl?: string; nextUrl?: string };

export function createOpdsFeedRows(feed: OpdsFeed): OpdsFeedRow[] {
  const rows: OpdsFeedRow[] = [{ kind: "intro", key: "intro", feed }];
  if (feed.navigation.length > 0) {
    rows.push({ kind: "section", key: "navigation-title", title: "collections" });
    feed.navigation.forEach((item, index) =>
      rows.push({
        kind: "link",
        key: `navigation:${index}:${item.url}`,
        title: item.title,
        url: item.url,
        icon: true,
      }),
    );
  }
  feed.facets.forEach((facet, facetIndex) => {
    rows.push({ kind: "section", key: `facet-title:${facetIndex}`, title: facet.title });
    facet.links.forEach((link, linkIndex) =>
      rows.push({
        kind: "link",
        key: `facet:${facetIndex}:${linkIndex}:${link.url}`,
        title: link.title ?? link.url,
        url: link.url,
        icon: false,
      }),
    );
  });
  if (feed.publications.length > 0) {
    rows.push({ kind: "section", key: "books-title", title: "books" });
    feed.publications.forEach((publication, index) =>
      rows.push({
        kind: "publication",
        key: `publication:${publication.id ?? index}:${publication.title}`,
        publication,
        keyPrefix: "publication",
      }),
    );
  }
  feed.groups.forEach((group, groupIndex) => {
    rows.push({ kind: "section", key: `group-title:${groupIndex}`, title: group.title });
    group.navigation.forEach((item, itemIndex) =>
      rows.push({
        kind: "link",
        key: `group-link:${groupIndex}:${itemIndex}:${item.url}`,
        title: item.title,
        url: item.url,
        icon: false,
      }),
    );
    group.publications.forEach((publication, publicationIndex) =>
      rows.push({
        kind: "publication",
        key: `group-publication:${groupIndex}:${publication.id ?? publicationIndex}`,
        publication,
        keyPrefix: `group-${groupIndex}`,
      }),
    );
  });
  if (feed.navigation.length === 0 && feed.publications.length === 0 && feed.groups.length === 0) {
    rows.push({ kind: "empty", key: "empty" });
  }
  if (feed.previousUrl || feed.nextUrl) {
    rows.push({
      kind: "pagination",
      key: "pagination",
      ...(feed.previousUrl ? { previousUrl: feed.previousUrl } : {}),
      ...(feed.nextUrl ? { nextUrl: feed.nextUrl } : {}),
    });
  }
  return rows;
}
