export type OpdsAcquisitionRelationKind =
  | "direct"
  | "borrow"
  | "buy"
  | "preview"
  | "sample"
  | "subscribe";

export interface OpdsAcquisitionRelation {
  kind: OpdsAcquisitionRelationKind;
  downloadable: boolean;
}

const OPDS1_ACQUISITION = "http://opds-spec.org/acquisition";

const RELATIONS: Readonly<Record<string, OpdsAcquisitionRelation>> = {
  acquisition: { kind: "direct", downloadable: true },
  download: { kind: "direct", downloadable: true },
  borrow: { kind: "borrow", downloadable: false },
  buy: { kind: "buy", downloadable: false },
  preview: { kind: "preview", downloadable: false },
  sample: { kind: "sample", downloadable: false },
  subscribe: { kind: "subscribe", downloadable: false },
  [OPDS1_ACQUISITION]: { kind: "direct", downloadable: true },
  [`${OPDS1_ACQUISITION}/open-access`]: { kind: "direct", downloadable: true },
  [`${OPDS1_ACQUISITION}/borrow`]: { kind: "borrow", downloadable: false },
  [`${OPDS1_ACQUISITION}/buy`]: { kind: "buy", downloadable: false },
  [`${OPDS1_ACQUISITION}/preview`]: { kind: "preview", downloadable: false },
  [`${OPDS1_ACQUISITION}/sample`]: { kind: "sample", downloadable: false },
  [`${OPDS1_ACQUISITION}/subscribe`]: { kind: "subscribe", downloadable: false },
};

export function classifyOpdsAcquisitionRelation(
  relations: readonly string[],
): OpdsAcquisitionRelation | undefined {
  for (const relation of relations) {
    const classification = RELATIONS[relation.toLowerCase()];
    if (classification) return classification;
  }
  return undefined;
}
