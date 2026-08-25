export interface OpdsUrlClassification {
  allowed: boolean;
  requiresInsecureConfirmation: boolean;
  reason?: "credentials-not-allowed" | "unsupported-scheme" | "public-http" | "invalid-url";
}

function denied(reason: NonNullable<OpdsUrlClassification["reason"]>): OpdsUrlClassification {
  return { allowed: false, requiresInsecureConfirmation: false, reason };
}

function hasUserInfo(value: string): boolean {
  const authority = /^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/i.exec(value)?.[1];
  return authority?.includes("@") ?? false;
}

function parseIpv4(hostname: string): number[] | undefined {
  const parts = hostname.split(".");
  if (parts.length !== 4) return undefined;
  const octets = parts.map(Number);
  return octets.every((octet, index) => /^\d+$/.test(parts[index] ?? "") && octet <= 255)
    ? octets
    : undefined;
}

function isLocalIpv4(octets: number[]): boolean {
  const [first, second] = octets;
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}

function parseIpv6(hostname: string): number[] | undefined {
  const value = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!value || value.includes("%") || value.split("::").length > 2) return undefined;

  const expandPart = (part: string): string[] | undefined => {
    if (!part) return [];
    const segments = part.split(":");
    const last = segments[segments.length - 1];
    if (last?.includes(".")) {
      const ipv4 = parseIpv4(last);
      if (!ipv4) return undefined;
      segments.splice(
        -1,
        1,
        ((ipv4[0] ?? 0) * 256 + (ipv4[1] ?? 0)).toString(16),
        ((ipv4[2] ?? 0) * 256 + (ipv4[3] ?? 0)).toString(16),
      );
    }
    return segments;
  };

  const [leftValue, rightValue] = value.split("::");
  const left = expandPart(leftValue ?? "");
  const right = expandPart(rightValue ?? "");
  if (!left || !right) return undefined;
  const missing = 8 - left.length - right.length;
  if ((value.includes("::") && missing < 1) || (!value.includes("::") && missing !== 0)) {
    return undefined;
  }

  const segments = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (segments.length !== 8 || segments.some((segment) => !/^[\da-f]{1,4}$/.test(segment))) {
    return undefined;
  }
  return segments.map((segment) => Number.parseInt(segment, 16));
}

function isLocalIpv6(segments: number[]): boolean {
  const first = segments[0] ?? 0;
  const isLoopback = segments.slice(0, 7).every((segment) => segment === 0) && segments[7] === 1;
  const isUniqueLocal = (first & 0xfe00) === 0xfc00;
  const isLinkLocal = (first & 0xffc0) === 0xfe80;
  const isIpv4Mapped =
    segments.slice(0, 5).every((segment) => segment === 0) && segments[5] === 0xffff;
  if (isIpv4Mapped) {
    const high = segments[6] ?? 0;
    const low = segments[7] ?? 0;
    return isLocalIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
  }
  return isLoopback || isUniqueLocal || isLinkLocal;
}

function isLocalHttpHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (
    normalized === "localhost" ||
    (normalized.length > ".local".length && normalized.endsWith(".local"))
  ) {
    return true;
  }
  const ipv4 = parseIpv4(normalized);
  if (ipv4) return isLocalIpv4(ipv4);
  const ipv6 = parseIpv6(normalized);
  return ipv6 ? isLocalIpv6(ipv6) : false;
}

/**
 * Applies a syntactic URL policy only. It deliberately does not resolve or pin DNS, and must not
 * be described as protection against DNS rebinding for otherwise allowed HTTPS hostnames.
 */
export function classifyOpdsUrl(value: string): OpdsUrlClassification {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return denied("invalid-url");
  }

  if (hasUserInfo(value) || url.username || url.password) {
    return denied("credentials-not-allowed");
  }
  if (url.protocol === "https:") {
    return { allowed: true, requiresInsecureConfirmation: false };
  }
  if (url.protocol !== "http:") return denied("unsupported-scheme");
  if (!isLocalHttpHost(url.hostname)) return denied("public-http");
  return { allowed: true, requiresInsecureConfirmation: true };
}
