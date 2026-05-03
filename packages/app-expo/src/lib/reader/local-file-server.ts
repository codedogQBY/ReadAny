import { File } from "expo-file-system";

const servers = new Map<string, { server: any; url: string }>();

const EXT_MIME: Record<string, string> = {
  ".epub": "application/epub+zip",
  ".pdf": "application/pdf",
  ".mobi": "application/x-mobipocket-ebook",
  ".azw": "application/vnd.amazon.ebook",
  ".azw3": "application/vnd.amazon.ebook",
  ".cbz": "application/vnd.comicbook+zip",
  ".fb2": "application/x-fictionbook+xml",
  ".txt": "text/plain",
};

function guessMime(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return EXT_MIME[ext] || "application/octet-stream";
}

/**
 * Start a local HTTP server that serves files from `docRoot`.
 * Returns the base URL (e.g. `http://127.0.0.1:54321`).
 * Reuses the existing server if one is already running for the same docRoot.
 */
export async function startFileServer(docRoot: string): Promise<string> {
  const key = docRoot.replace(/\/+$/, "");
  const existing = servers.get(key);
  if (existing) return existing.url;

  let TcpSocket: any;
  try {
    TcpSocket = (await import("react-native-tcp-socket")).default;
  } catch (e) {
    throw new Error(`TCP Socket unavailable: ${e instanceof Error ? e.message : e}`);
  }

  const cleanRoot = key.replace(/\/+$/, "");

  return new Promise<string>((resolve, reject) => {
    const server = TcpSocket.createServer((socket: any) => {
      let headerBuf = "";

      socket.on("data", async (data: any) => {
        headerBuf += data.toString();

        const headerEnd = headerBuf.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;

        const requestLine = headerBuf.slice(0, headerBuf.indexOf("\r\n"));
        const [, rawPath] = requestLine.split(" ") || [];

        if (!rawPath || rawPath === "/favicon.ico") {
          socket.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
          socket.destroy();
          return;
        }

        const decodedPath = decodeURIComponent(rawPath.slice(1));
        if (decodedPath.includes("..")) {
          socket.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
          socket.destroy();
          return;
        }

        const filePath = `${cleanRoot}/${decodedPath}`;
        let file: InstanceType<typeof File>;
        try {
          file = new File(filePath);
          if (!file.exists) {
            socket.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
            socket.destroy();
            return;
          }
        } catch {
          socket.write("HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n");
          socket.destroy();
          return;
        }

        const size = file.size;
        const mime = guessMime(filePath);

        socket.write(
          `HTTP/1.1 200 OK\r\nContent-Type: ${mime}\r\nContent-Length: ${size}\r\nConnection: close\r\n\r\n`,
        );

        // Read file and write in 64KB chunks
        let fileData: Uint8Array;
        try {
          fileData = await file.bytes();
        } catch {
          socket.destroy();
          return;
        }

        const CHUNK = 65536;
        let offset = 0;
        const pump = () => {
          if (offset >= fileData.length) {
            socket.destroy();
            return;
          }
          const end = Math.min(offset + CHUNK, fileData.length);
          const chunk = fileData.slice(offset, end);
          offset = end;
          try {
            socket.write(chunk, undefined, (err?: Error) => {
              if (err) { socket.destroy(); return; }
              pump();
            });
          } catch {
            socket.destroy();
          }
        };

        try { pump(); } catch { socket.destroy(); }
      });

      socket.on("error", () => socket.destroy());
    });

    server.on("error", (err: Error) => reject(err));

    server.listen({ port: 0, host: "127.0.0.1" }, () => {
      const addr = server.address();
      const port = addr && typeof addr === "object" && "port" in addr ? addr.port : null;
      if (!port) {
        reject(new Error("Server address unavailable"));
        return;
      }
      const url = `http://127.0.0.1:${port}`;
      servers.set(key, { server, url });
      resolve(url);
    });
  });
}

/**
 * Stop the file server for the given docRoot (or all servers).
 */
export function stopFileServer(docRoot?: string): void {
  if (docRoot) {
    const key = docRoot.replace(/\/+$/, "");
    const entry = servers.get(key);
    if (entry) {
      entry.server.close();
      servers.delete(key);
    }
  } else {
    for (const [, entry] of servers) {
      entry.server.close();
    }
    servers.clear();
  }
}
