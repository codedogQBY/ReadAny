import { describe, expect, it } from "vitest";
import { isDialableLanAddress } from "./lan-server";

describe("isDialableLanAddress", () => {
  it("accepts LAN addresses a peer can reach", () => {
    expect(isDialableLanAddress("192.168.57.185")).toBe(true); // USB tethering
    expect(isDialableLanAddress("192.168.1.100")).toBe(true); // Wi-Fi
    expect(isDialableLanAddress("10.84.37.34")).toBe(true);
    expect(isDialableLanAddress("172.16.5.9")).toBe(true);
  });

  it("rejects the sentinel auto-detection returns when it cannot tell", () => {
    // expo-network documents 0.0.0.0 as "the IP address could not be retrieved"
    // and reports it whenever the Android device is off Wi-Fi — sharing a
    // connection over USB tethering, for instance. It used to be published as
    // the address peers should dial.
    expect(isDialableLanAddress("0.0.0.0")).toBe(false);
  });

  it("rejects addresses no peer could ever dial", () => {
    expect(isDialableLanAddress("127.0.0.1")).toBe(false); // loopback
    expect(isDialableLanAddress("169.254.203.33")).toBe(false); // link-local
    expect(isDialableLanAddress("224.0.0.1")).toBe(false); // multicast
    expect(isDialableLanAddress("255.255.255.255")).toBe(false); // broadcast
  });

  it("rejects missing and malformed values", () => {
    expect(isDialableLanAddress("")).toBe(false);
    expect(isDialableLanAddress(null)).toBe(false);
    expect(isDialableLanAddress(undefined)).toBe(false);
    expect(isDialableLanAddress("192.168.57")).toBe(false); // too few octets
    expect(isDialableLanAddress("192.168.57.1.2")).toBe(false); // too many
    expect(isDialableLanAddress("192.168.57.300")).toBe(false); // out of range
    expect(isDialableLanAddress("not-an-ip")).toBe(false);
  });

  it("rejects IPv6 values", () => {
    expect(isDialableLanAddress("::1")).toBe(false);
    expect(isDialableLanAddress("fe80::1")).toBe(false);
    expect(isDialableLanAddress("::ffff:192.168.1.1")).toBe(false);
  });
});
