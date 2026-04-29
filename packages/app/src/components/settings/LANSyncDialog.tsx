import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useSyncStore } from "@/stores/sync-store";
import type { LANConnectionState } from "@readany/core/sync/lan-backend";
import { createLANBackend } from "@readany/core/sync/lan-backend";
import {
  type LANQRData,
  type LANServerStatus,
  createLANServer,
} from "@readany/core/sync/lan-server";
import { QRCodeSVG } from "qrcode.react";
/**
 * LANSyncDialog — LAN sync configuration dialog with QR code and manual connection.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface LANSyncDialogProps {
  open: boolean;
  onClose: () => void;
  mode: "server" | "client";
}

export function LANSyncDialog({ open, onClose, mode }: LANSyncDialogProps) {
  const { t } = useTranslation();
  const { syncWithBackend } = useSyncStore();

  const isManualIPError = useCallback((message: string): boolean => {
    return (
      message.includes("Could not determine local IP address") ||
      message.includes("Failed to get local IP") ||
      message.includes("Cannot auto-detect IP address")
    );
  }, []);

  const normalizeServerError = useCallback(
    (message: string): string => {
      if (message.includes("Tauri desktop runtime is required")) {
        return t("settings.syncLANTauriRequired");
      }
      return message;
    },
    [t],
  );

  // Server state
  const [serverStatus, setServerStatus] = useState<LANServerStatus>("idle");
  const [qrData, setQRData] = useState<LANQRData | null>(null);
  const [server, setServer] = useState<ReturnType<typeof createLANServer> | null>(null);

  // Client state
  const [connectionState, setConnectionState] = useState<LANConnectionState>("idle");
  const [manualIP, setManualIP] = useState("");
  const [manualPort, setManualPort] = useState("");
  const [manualPairCode, setManualPairCode] = useState("");

  // Manual IP for server (when auto-detection fails)
  const [showManualIPInput, setShowManualIPInput] = useState(false);
  const [manualServerIP, setManualServerIP] = useState("");

  const [error, setError] = useState("");

  const confirmLanImport = useCallback(() => {
    return window.confirm(
      t(
        "settings.syncLANImportWarning",
        "This will overwrite this device's database, books, and covers with the server device data. Use it for migration, not two-way merge.",
      ),
    );
  }, [t]);

  // Server mode: start/stop server
  const handleStartServer = useCallback(async () => {
    setError("");
    setServerStatus("starting");
    setShowManualIPInput(false);

    try {
      const deviceName = `ReadAny Desktop`;

      const newServer = createLANServer({
        deviceName,
        events: {
          onStatusChange: setServerStatus,
          onError: (err) => {
            setError(normalizeServerError(err));
            setShowManualIPInput(isManualIPError(err));
          },
        },
      });

      await newServer.start();
      const data = newServer.getQRData();
      if (data) {
        setQRData(data);
      }
      setServer(newServer);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(normalizeServerError(errorMsg));
      setServerStatus("error");
      setShowManualIPInput(isManualIPError(errorMsg));
    }
  }, [isManualIPError, normalizeServerError]);

  const handleStartWithManualIP = useCallback(async () => {
    if (!manualServerIP) {
      setError(t("settings.syncLANFillAll"));
      return;
    }

    setError("");
    setServerStatus("starting");

    try {
      const deviceName = `ReadAny Desktop`;

      const newServer = createLANServer({
        deviceName,
        events: {
          onStatusChange: setServerStatus,
          onError: (err) => setError(normalizeServerError(err)),
        },
      });

      // Set manual IP before starting
      newServer.setManualIP(manualServerIP);
      await newServer.start();
      const data = newServer.getQRData();
      if (data) {
        setQRData(data);
      }
      setServer(newServer);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(normalizeServerError(errorMsg));
      setServerStatus("error");
    }
  }, [manualServerIP, normalizeServerError, t]);

  const handleStopServer = useCallback(async () => {
    if (server) {
      await server.stop();
      setServer(null);
    }
    setServerStatus("idle");
    setQRData(null);
    setShowManualIPInput(false);
    setManualServerIP("");
  }, [server]);

  // Client mode: manual connect
  const handleManualConnect = useCallback(async () => {
    if (!manualIP || !manualPort || !manualPairCode) {
      setError(t("settings.syncLANFillAll"));
      return;
    }

    setError("");
    setConnectionState("connecting");

    try {
      const serverUrl = `http://${manualIP}:${manualPort}`;
      const backend = createLANBackend(serverUrl, manualPairCode, "Mobile");

      const connected = await backend.testConnection();
      if (!connected) {
        throw new Error(t("settings.syncLANConnectionFailed"));
      }

      if (!confirmLanImport()) {
        setConnectionState("idle");
        return;
      }

      setConnectionState("connected");

      // LAN is a one-off import flow: pull the server snapshot and related files.
      const result = await syncWithBackend(backend);
      if (!result || !result.success) {
        throw new Error(result?.error || t("settings.syncLANConnectionFailed"));
      }
      setConnectionState("idle");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setConnectionState("error");
    }
  }, [manualIP, manualPort, manualPairCode, confirmLanImport, onClose, syncWithBackend, t]);

  // Cleanup on close
  useEffect(() => {
    if (!open) {
      handleStopServer();
      setConnectionState("idle");
      setError("");
      setManualIP("");
      setManualPort("");
      setManualPairCode("");
    }
  }, [open, handleStopServer]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogTitle>
          {mode === "server" ? t("settings.syncLANServerTitle") : t("settings.syncLANClientTitle")}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {mode === "server" ? t("settings.syncLANServerDesc") : t("settings.syncLANClientDesc")}
        </DialogDescription>

        {mode === "server" ? (
          <div className="space-y-4">
            {/* Server status */}
            <div className="flex items-center gap-2">
              <div
                className={`h-2 w-2 rounded-full ${
                  serverStatus === "running"
                    ? "bg-green-500"
                    : serverStatus === "error"
                      ? "bg-red-500"
                      : "bg-gray-400"
                }`}
              />
              <span className="text-sm text-muted-foreground">
                {t(`settings.syncLANServerStatus.${serverStatus}`)}
              </span>
            </div>

            {/* Manual IP input (shown when auto-detection fails) */}
            {showManualIPInput && serverStatus !== "running" && (
              <div className="rounded-lg border border-orange-400/60 bg-orange-50/40 p-3 dark:bg-orange-950/20">
                <p className="text-xs text-muted-foreground mb-2">
                  {t("settings.syncLANManualIPHint")}
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={manualServerIP}
                    onChange={(e) => setManualServerIP(e.target.value)}
                    placeholder="192.168.1.100"
                    className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                  />
                  <button
                    onClick={handleStartWithManualIP}
                    disabled={!manualServerIP}
                    className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    {t("settings.syncLANServerStart")}
                  </button>
                </div>
              </div>
            )}

            {/* QR Code display */}
            {qrData && (
              <div className="flex flex-col items-center space-y-3">
                <div className="rounded-lg bg-white p-4">
                  <QRCodeSVG
                    value={JSON.stringify(qrData)}
                    size={192}
                    level="L"
                    includeMargin={false}
                  />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium">{t("settings.syncLANPairCode")}</p>
                  <p className="text-2xl font-mono tracking-widest">{qrData.pairCode}</p>
                </div>
                <div className="text-center text-xs text-muted-foreground mt-2 space-y-1">
                  <p>
                    {t("settings.syncLANIP")}:{" "}
                    <span className="font-mono text-foreground">{qrData.ip}</span>
                  </p>
                  <p>
                    {t("settings.syncLANPort")}:{" "}
                    <span className="font-mono text-foreground">{qrData.port}</span>
                  </p>
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  {t("settings.syncLANServerHint")}
                </p>
              </div>
            )}

            {/* Error display */}
            {error && !showManualIPInput && (
              <div className="rounded-md bg-red-50/60 p-3 text-xs text-red-500 dark:bg-red-950/20">
                {error}
              </div>
            )}

            {/* Start/Stop buttons */}
            {!showManualIPInput && (
              <div className="flex gap-2">
                {serverStatus !== "running" ? (
                  <button
                    onClick={handleStartServer}
                    disabled={serverStatus === "starting"}
                    className="flex-1 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    {serverStatus === "starting"
                      ? t("settings.syncLANServerStarting")
                      : t("settings.syncLANServerStart")}
                  </button>
                ) : (
                  <button
                    onClick={handleStopServer}
                    className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
                  >
                    {t("settings.syncLANServerStop")}
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Manual connection */}
            <div className="space-y-3">
              <p className="text-sm font-medium">{t("settings.syncLANManualConnect")}</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    {t("settings.syncLANIP")}
                  </label>
                  <input
                    type="text"
                    value={manualIP}
                    onChange={(e) => setManualIP(e.target.value)}
                    placeholder="192.168.1.100"
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    {t("settings.syncLANPort")}
                  </label>
                  <input
                    type="text"
                    value={manualPort}
                    onChange={(e) => setManualPort(e.target.value)}
                    placeholder="8080"
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  {t("settings.syncLANPairCodeLabel")}
                </label>
                <input
                  type="text"
                  value={manualPairCode}
                  onChange={(e) => setManualPairCode(e.target.value)}
                  placeholder="123456"
                  maxLength={6}
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                />
              </div>
            </div>

            {/* Error display */}
            {error && (
              <div className="rounded-md bg-red-50/60 p-3 text-xs text-red-500 dark:bg-red-950/20">
                {error}
              </div>
            )}

            {/* Connect button */}
            <button
              onClick={handleManualConnect}
              disabled={connectionState === "connecting"}
              className="w-full rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {connectionState === "connecting"
                ? t("settings.syncLANConnecting")
                : t("settings.syncLANConnect")}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
