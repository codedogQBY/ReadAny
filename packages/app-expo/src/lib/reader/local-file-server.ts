/**
 * Native local HTTP file server for serving book files to the WebView.
 *
 * Tries @dr.pogodin/react-native-static-server (embedded Lighttpd) first:
 * - Serves files directly from the native layer (no JS bridge overhead)
 * - Supports HTTP Range requests (206 Partial Content) out of the box
 * - Enables foliate-js to lazily read ZIP entries without loading the entire file
 *
 * Falls back to react-native-tcp-socket JS-layer server if the native static
 * server module is not available (e.g. during development without a rebuild).
 */
import { File } from "expo-file-system";

// --- State ---
let _nativeServer: any | null = null;
let _tcpServer: any | null = null;
let _serverUrl: string | null = null;
let _serverDocRoot: string | null = null;
let _useNative: boolean | null = null; // null = not yet determined

const CORS_HEADERS =
  "Access-Control-Allow-Origin: *\r\n" +
  "Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n" +
  "Access-Control-Allow-Headers: Range, Content-Type\r\n" +
  "Access-Control-Expose-Headers: Accept-Ranges, Content-Length, Content-Range\r\n";

const LIGHTTPD_CORS_CONFIG = `
server.modules += ("mod_setenv")
setenv.add-response-header = (
  "Access-Control-Allow-Origin" => "*",
  "Access-Control-Allow-Methods" => "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers" => "Range, Content-Type",
  "Access-Control-Expose-Headers" => "Accept-Ranges, Content-Length, Content-Range"
)
`;

/**
 * Start a local file server serving files from `docRoot`.
 * Returns the base URL (e.g. `http://127.0.0.1:12345`).
 * Reuses the existing server if one is already running for the same docRoot.
 */
export async function startFileServer(docRoot: string): Promise<string> {
  // Strip file:// URI prefix — native servers need plain filesystem paths
  let cleanRoot = docRoot.replace(/\/+$/, "");
  if (cleanRoot.startsWith("file://")) {
    cleanRoot = decodeURIComponent(cleanRoot.slice(7));
  }

  // Reuse existing server
  if (_serverUrl && _serverDocRoot === cleanRoot) {
    // Check if native server is still active
    if (_nativeServer) {
      try {
        const { STATES } = await import("@dr.pogodin/react-native-static-server");
        if (_nativeServer.state === STATES.ACTIVE) return _serverUrl;
      } catch {}
    }
    if (_tcpServer) return _serverUrl;
  }

  // Stop existing
  await stopFileServer();

  // Determine which backend to use (once)
  if (_useNative === null) {
    try {
      await import("@dr.pogodin/react-native-static-server");
      _useNative = true;
    } catch {
      _useNative = false;
    }
  }

  if (_useNative) {
    return _startNativeServer(cleanRoot);
  }
  return _startTcpFallback(cleanRoot);
}

// --- Native Lighttpd server ---
async function _startNativeServer(cleanRoot: string): Promise<string> {
  let server: any = null;
  try {
    const StaticServerModule = await import("@dr.pogodin/react-native-static-server");
    const StaticServer = StaticServerModule.default;

    server = new StaticServer({
      fileDir: cleanRoot,
      port: 0,
      extraConfig: LIGHTTPD_CORS_CONFIG,
      stopInBackground: false,
    });
    // Cap server.start() so a hung Lighttpd init can't pin the reader on a spinner.
    // On timeout we treat it the same as a throw: stop and fall back to TCP below.
    const origin = await Promise.race([
      server.start(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Lighttpd startup timeout (3s)")), 3000),
      ),
    ]);
    _nativeServer = server;
    _serverDocRoot = cleanRoot;
    _serverUrl = origin;
    console.log(`[FileServer] Native Lighttpd started: ${origin} (root: ${cleanRoot})`);
    return origin;
  } catch (e) {
    // Native module unavailable at runtime (e.g. peer dep @dr.pogodin/react-native-fs
    // not linked into the native binary). Drop down to the JS TCP fallback so reading
    // still works without rebuilding the dev client.
    console.warn(
      `[FileServer] Native Lighttpd unavailable (${e instanceof Error ? e.message : e}), falling back to TCP`,
    );
    if (server) {
      try {
        await server.stop?.();
      } catch {}
    }
    _nativeServer = null;
    _useNative = false;
    return _startTcpFallback(cleanRoot);
  }
}

// --- Fallback: JS TCP server (original implementation) ---
async function _startTcpFallback(cleanRoot: string): Promise<string> {
  // TCP fallback also needs plain path
  let fsRoot = cleanRoot;
  if (fsRoot.startsWith("file://")) {
    fsRoot = decodeURIComponent(fsRoot.slice(7));
  }

  let TcpSocket: any;
  try {
    TcpSocket = (await import("react-native-tcp-socket")).default;
    console.log("[FileServer] TCP socket module loaded, starting server...");
  } catch (e) {
    throw new Error(`No file server available: ${e instanceof Error ? e.message : e}`);
  }

  return new Promise<string>((resolve, reject) => {
    // Safety timeout: if the TCP server can't bind within 5s, bail out
    const tcpTimeout = setTimeout(() => {
      reject(new Error("TCP server startup timeout (5s)"));
    }, 5000);

    const server = TcpSocket.createServer((socket: any) => {
      let headerBuf = "";

      socket.on("data", async (data: any) => {
        headerBuf += data.toString();

        const headerEnd = headerBuf.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;

        const requestLine = headerBuf.slice(0, headerBuf.indexOf("\r\n"));
        const [method = "GET", rawPath] = requestLine.split(" ") || [];
        const normalizedMethod = method.toUpperCase();

        if (!rawPath || rawPath === "/favicon.ico") {
          socket.write(`HTTP/1.1 404 Not Found\r\n${CORS_HEADERS}Content-Length: 0\r\n\r\n`);
          socket.destroy();
          return;
        }

        if (normalizedMethod === "OPTIONS") {
          socket.write(`HTTP/1.1 204 No Content\r\n${CORS_HEADERS}Content-Length: 0\r\n\r\n`);
          socket.destroy();
          return;
        }

        const decodedPath = decodeURIComponent(rawPath.slice(1));
        if (decodedPath.includes("..")) {
          socket.write(`HTTP/1.1 403 Forbidden\r\n${CORS_HEADERS}Content-Length: 0\r\n\r\n`);
          socket.destroy();
          return;
        }

        const filePath = `${fsRoot}/${decodedPath}`;
        const fileUri = toFileUri(filePath);
        let file: InstanceType<typeof File>;
        try {
          file = new File(fileUri);
          if (!file.exists) {
            console.warn(`[FileServer] TCP file not found: ${fileUri}`);
            socket.write(`HTTP/1.1 404 Not Found\r\n${CORS_HEADERS}Content-Length: 0\r\n\r\n`);
            socket.destroy();
            return;
          }
        } catch (e) {
          console.warn(
            `[FileServer] TCP failed to open file: ${fileUri} (${e instanceof Error ? e.message : e})`,
          );
          socket.write(
            `HTTP/1.1 500 Internal Server Error\r\n${CORS_HEADERS}Content-Length: 0\r\n\r\n`,
          );
          socket.destroy();
          return;
        }

        const size = file.size;
        const mime = _guessMime(filePath);
        const rangeHeader = headerBuf.match(/^Range:\s*bytes=(\d*)-(\d*)/im);
        let start = 0;
        let end = size > 0 ? size - 1 : 0;
        let statusLine = "HTTP/1.1 200 OK";
        let contentRangeHeader = "";

        if (rangeHeader) {
          const requestedStart = rangeHeader[1] ? Number.parseInt(rangeHeader[1], 10) : 0;
          const requestedEnd = rangeHeader[2] ? Number.parseInt(rangeHeader[2], 10) : end;
          if (
            Number.isNaN(requestedStart) ||
            Number.isNaN(requestedEnd) ||
            requestedStart >= size ||
            requestedEnd < requestedStart
          ) {
            socket.write(
              `HTTP/1.1 416 Range Not Satisfiable\r\n${CORS_HEADERS}Content-Range: bytes */${size}\r\nContent-Length: 0\r\n\r\n`,
            );
            socket.destroy();
            return;
          }
          start = requestedStart;
          end = Math.min(requestedEnd, size - 1);
          statusLine = "HTTP/1.1 206 Partial Content";
          contentRangeHeader = `Content-Range: bytes ${start}-${end}/${size}\r\n`;
        }

        const contentLength = Math.max(0, end - start + 1);

        socket.write(
          `${statusLine}\r\nContent-Type: ${mime}\r\nContent-Length: ${contentLength}\r\nAccept-Ranges: bytes\r\n${contentRangeHeader}${CORS_HEADERS}Connection: close\r\n\r\n`,
        );

        if (normalizedMethod === "HEAD") {
          socket.destroy();
          return;
        }

        let fileData: Uint8Array;
        try {
          fileData = await file.bytes();
        } catch (e) {
          console.warn(
            `[FileServer] TCP failed to read file: ${fileUri} (${e instanceof Error ? e.message : e})`,
          );
          socket.destroy();
          return;
        }

        const CHUNK = 65536;
        let offset = start;
        const pump = () => {
          if (offset > end) {
            socket.destroy();
            return;
          }
          const chunkEnd = Math.min(offset + CHUNK - 1, end);
          const chunk = fileData.slice(offset, chunkEnd + 1);
          offset = chunkEnd + 1;
          try {
            socket.write(chunk, undefined, (err?: Error) => {
              if (err) {
                socket.destroy();
                return;
              }
              pump();
            });
          } catch {
            socket.destroy();
          }
        };

        try {
          pump();
        } catch {
          socket.destroy();
        }
      });

      socket.on("error", () => socket.destroy());
    });

    server.on("error", (err: Error) => {
      clearTimeout(tcpTimeout);
      reject(err);
    });

    server.listen({ port: 0, host: "127.0.0.1" }, () => {
      clearTimeout(tcpTimeout);
      const addr = server.address();
      const port = addr && typeof addr === "object" && "port" in addr ? addr.port : null;
      if (!port) {
        reject(new Error("Server address unavailable"));
        return;
      }
      const url = `http://127.0.0.1:${port}`;
      _tcpServer = server;
      _serverDocRoot = cleanRoot;
      _serverUrl = url;
      console.log(`[FileServer] TCP fallback started: ${url} (root: ${cleanRoot})`);
      resolve(url);
    });
  });
}

/**
 * Stop the file server.
 */
export async function stopFileServer(_docRoot?: string): Promise<void> {
  if (_nativeServer) {
    try {
      await _nativeServer.stop();
    } catch {}
    _nativeServer = null;
  }
  if (_tcpServer) {
    try {
      _tcpServer.close();
    } catch {}
    _tcpServer = null;
  }
  _serverUrl = null;
  _serverDocRoot = null;
}

// --- Helpers ---
const EXT_MIME: Record<string, string> = {
  ".epub": "application/epub+zip",
  ".pdf": "application/pdf",
  ".mobi": "application/x-mobipocket-ebook",
  ".azw": "application/vnd.amazon.ebook",
  ".azw3": "application/vnd.amazon.ebook",
  ".cbz": "application/vnd.comicbook+zip",
  ".fb2": "application/x-fictionbook+xml",
  ".txt": "text/plain",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function _guessMime(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return EXT_MIME[ext] || "application/octet-stream";
}

function toFileUri(path: string): string {
  return path.startsWith("file://") ? path : `file://${path}`;
}
