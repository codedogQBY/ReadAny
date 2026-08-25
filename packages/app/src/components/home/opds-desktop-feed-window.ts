import type { OpdsFeed } from "@readany/core";

export interface WindowedOpdsFeed {
  publications: OpdsFeed["publications"];
  groups: OpdsFeed["groups"];
  total: number;
  hasMore: boolean;
}

export function windowOpdsFeedPublications(
  feed: OpdsFeed,
  requestedLimit: number,
): WindowedOpdsFeed {
  const limit = Math.max(0, Math.floor(requestedLimit));
  let remaining = limit;
  const publications = feed.publications.slice(0, remaining);
  remaining -= publications.length;
  const groups = feed.groups.map((group) => {
    const visible = group.publications.slice(0, remaining);
    remaining -= visible.length;
    return { ...group, publications: visible };
  });
  const total =
    feed.publications.length +
    feed.groups.reduce((count, group) => count + group.publications.length, 0);
  return { publications, groups, total, hasMore: total > limit };
}
