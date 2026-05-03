/**
 * LAN sync backend implementation.
 * Provides peer-to-peer sync over local network via HTTP.
 */

import { getPlatformService } from "../services/platform";
import { generateId } from "../utils/generate-id";
import type { ISyncBackend, RemoteFile } from "./sync-backend";

/** LAN sync QR code data */
export interface LANQRData {
  v: number;
  type: "readany-lan-sync";
  ip: string;
  port: number;
  name: string;
  pairCode: string;
  keyFingerprint: string;
}

/** LAN sync server info */
export interface LANServerInfo {
  ip: string;
  port: number;
  name: string;
  pairCode: string;
}

/** LAN sync connection state */
export type LANConnectionState = "idle" | "waiting" | "connecting" | "connected" | "error";

/**
 * LAN sync backend for receiving data from another device.
 * This is a client-side implementation that connects to a LAN server.
 */
export class LANBackend implements ISyncBackend {
  readonly type = "lan" as const;
  private serverUrl: string;
  private pairCode: string;
  private deviceName: string;
  private abortController: AbortController | null = null;

  constructor(serverUrl: string, pairCode: string, deviceName: string) {
    this.serverUrl = serverUrl.replace(/\/+$/, "");
    this.pairCode = pairCode;
    this.deviceName = deviceName;
  }

  private getFetchFn() {
    const platform = getPlatformService();
    return platform.fetch ? platform.fetch.bind(platform) : globalThis.fetch.bind(globalThis);
  }

  async testConnection(): Promise<boolean> {
    try {
      const fetchFn = this.getFetchFn();
      const response = await fetchFn(`${this.serverUrl}/ping`, {
        method: "GET",
        headers: {
          "X-Pair-Code": this.pairCode,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async ensureDirectories(): Promise<void> {
    // No-op for LAN - server handles this
  }

  async put(_path: string, _data: Uint8Array): Promise<void> {
    throw new Error("LAN backend does not support upload (receive-only)");
  }

  async get(path: string): Promise<Uint8Array> {
    const fetchFn = this.getFetchFn();
    const response = await fetchFn(`${this.serverUrl}/file${path}`, {
      method: "GET",
      headers: {
        "X-Pair-Code": this.pairCode,
      },
    });

    if (!response.ok) {
      throw new Error(`LAN GET failed for ${path}: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }

  async getJSON<T>(path: string): Promise<T | null> {
    try {
      const data = await this.get(path);
      const text = new TextDecoder().decode(data);
      return JSON.parse(text) as T;
    } catch (e) {
      const err = e as { message?: string };
      if (err.message?.includes("404")) return null;
      throw e;
    }
  }

  async putJSON<T>(_path: string, _data: T): Promise<void> {
    throw new Error("LAN backend does not support upload (receive-only)");
  }

  async listDir(path: string): Promise<RemoteFile[]> {
    const fetchFn = this.getFetchFn();
    const response = await fetchFn(`${this.serverUrl}/list${path}`, {
      method: "GET",
      headers: {
        "X-Pair-Code": this.pairCode,
      },
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    return data as RemoteFile[];
  }

  async delete(_path: string): Promise<void> {
    throw new Error("LAN backend does not support delete (receive-only)");
  }

  async exists(path: string): Promise<boolean> {
    try {
      const fetchFn = this.getFetchFn();
      const response = await fetchFn(`${this.serverUrl}/exists${path}`, {
        method: "HEAD",
        headers: {
          "X-Pair-Code": this.pairCode,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getDisplayName(): Promise<string> {
    return `LAN (${this.deviceName})`;
  }

  async dispose(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}

/**
 * Create a LAN backend for receiving data.
 */
export function createLANBackend(
  serverUrl: string,
  pairCode: string,
  deviceName: string,
): LANBackend {
  return new LANBackend(serverUrl, pairCode, deviceName);
}

/**
 * Generate a 6-digit pair code.
 */
export function generatePairCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Parse LAN QR code data.
 */
export function parseLANQRData(data: string): LANQRData | null {
  try {
    if (!data || typeof data !== "string" || !data.trim().startsWith("{")) {
      return null;
    }
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed === "object" && parsed.type === "readany-lan-sync" && parsed.v === 1) {
      return parsed as LANQRData;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Create LAN QR code data.
 */
export function createLANQRData(
  ip: string,
  port: number,
  name: string,
  pairCode: string,
): LANQRData {
  return {
    v: 1,
    type: "readany-lan-sync",
    ip,
    port,
    name,
    pairCode,
    keyFingerprint: generateId().substring(0, 12),
  };
}
