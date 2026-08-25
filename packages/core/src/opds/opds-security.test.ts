import { describe, expect, it } from "vitest";
import { classifyOpdsUrl } from "./opds-security";

describe("classifyOpdsUrl", () => {
  it.each([
    "https://catalog.example/opds",
    "https://203.0.113.7/opds",
    "https://[2001:db8::7]/opds",
  ])("allows HTTPS globally", (url) => {
    expect(classifyOpdsUrl(url)).toEqual({
      allowed: true,
      requiresInsecureConfirmation: false,
    });
  });

  it.each([
    "http://localhost:8080/opds",
    "http://localhost./opds",
    "http://calibre.local/opds",
    "http://calibre.local./opds",
    "http://127.0.0.1/opds",
    "http://127.255.255.254/opds",
    "http://10.0.0.2/opds",
    "http://172.16.0.1/opds",
    "http://172.31.255.254/opds",
    "http://192.168.1.5:8080/opds",
    "http://169.254.10.20/opds",
    "http://2130706433/opds",
    "http://0x7f000001/opds",
    "http://[::1]/opds",
    "http://[fc00::1]/opds",
    "http://[fdff:ffff::1]/opds",
    "http://[fe80::1]/opds",
    "http://[febf:ffff::1]/opds",
    "http://[::ffff:127.0.0.1]/opds",
    "http://[::ffff:192.168.1.10]/opds",
  ])("allows local HTTP with confirmation: %s", (url) => {
    expect(classifyOpdsUrl(url)).toEqual({
      allowed: true,
      requiresInsecureConfirmation: true,
    });
  });

  it.each([
    "http://catalog.example/opds",
    "http://.local/opds",
    "http://example.localhost/opds",
    "http://localhost.example/opds",
    "http://calibre.local.example/opds",
    "http://127.0.0.1.example/opds",
    "http://10.0.0.1.nip.io/opds",
    "http://126.255.255.255/opds",
    "http://128.0.0.1/opds",
    "http://172.15.255.255/opds",
    "http://172.32.0.0/opds",
    "http://192.167.255.255/opds",
    "http://192.169.0.0/opds",
    "http://169.253.255.255/opds",
    "http://169.255.0.0/opds",
    "http://[fbff:ffff::1]/opds",
    "http://[fec0::1]/opds",
    "http://[2001:db8::1]/opds",
    "http://[::ffff:8.8.8.8]/opds",
  ])("rejects public HTTP and local-looking hostnames: %s", (url) => {
    expect(classifyOpdsUrl(url)).toMatchObject({
      allowed: false,
      requiresInsecureConfirmation: false,
    });
  });

  it.each([
    "https://user:password@catalog.example/opds",
    "https://user@catalog.example/opds",
    "http://user:password@127.0.0.1/opds",
  ])("rejects embedded URL credentials: %s", (url) => {
    expect(classifyOpdsUrl(url)).toMatchObject({
      allowed: false,
      requiresInsecureConfirmation: false,
    });
  });

  it.each([
    "file:///etc/passwd",
    "ftp://catalog.example/opds",
    "data:application/atom+xml,%3Cfeed%3E",
    "not a URL",
    "http://[fe80::1%25eth0]/opds",
  ])("rejects unsupported or malformed URLs: %s", (url) => {
    expect(classifyOpdsUrl(url)).toMatchObject({
      allowed: false,
      requiresInsecureConfirmation: false,
    });
  });
});
