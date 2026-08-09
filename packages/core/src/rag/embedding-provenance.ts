import { normalizeEmbeddingEndpointUrl } from "../utils/api";

/**
 * Persist the same canonical request URL that the embedding client uses. This
 * treats an API base URL, a trailing slash, and an explicit /embeddings URL as
 * the same endpoint identity.
 */
export function normalizeEmbeddingEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim();
  return trimmed ? normalizeEmbeddingEndpointUrl(trimmed) : "";
}
