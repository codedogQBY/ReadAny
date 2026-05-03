import { type LANQRData, createLANServer } from "@readany/core/sync/lan-server";
import type { ISyncBackend } from "@readany/core/sync/sync-backend";
import QRCode from "react-native-qrcode-svg";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Constants from "expo-constants";
import { CameraView, useCameraPermissions } from "expo-camera";
import {
  Animated,
  Alert,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Scan } from "lucide-react-native";
import { useColors } from "../../../styles/theme";
import { makeStyles } from "./sync-styles";

interface LanSectionProps {
  isBusy: boolean;
  progress: {
    phase: string;
    completedFiles: number;
    totalFiles: number;
    message?: string;
  } | null;
  pulseAnim: Animated.Value;
  progressLabel: () => string | null;
  onSyncWithBackend: (backend: ISyncBackend) => Promise<{ success: boolean; error?: string } | null>;
}

export function LanSection({
  isBusy,
  progress,
  pulseAnim,
  progressLabel,
  onSyncWithBackend,
}: LanSectionProps) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { t } = useTranslation();

  const [lanMode, setLanMode] = useState<"server" | "client">("server");
  const [lanServerStatus, setLanServerStatus] = useState<string>("idle");
  const [lanQrData, setLanQrData] = useState<LANQRData | null>(null);
  const [lanManualIP, setLanManualIP] = useState("");
  const [lanManualPort, setLanManualPort] = useState("");
  const [lanManualPairCode, setLanManualPairCode] = useState("");
  const [lanConnectionState, setLanConnectionState] = useState<string>("idle");
  const [lanServer, setLanServer] = useState<ReturnType<typeof createLANServer> | null>(null);
  const [lanError, setLanError] = useState("");
  const [showManualIPInput, setShowManualIPInput] = useState(false);
  const [lanManualServerIP, setLanManualServerIP] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const scannerHandledRef = useRef(false);
  const [scannerLocked, setScannerLocked] = useState(false);

  const handleStartLanServer = useCallback(async () => {
    setLanError("");
    setLanServerStatus("starting");
    setShowManualIPInput(false);
    try {
      const deviceName = "ReadAny Mobile";
      const server = createLANServer({
        deviceName,
        events: {
          onStatusChange: (status: string) => {
            setLanServerStatus(status);
            if (status === "error") setShowManualIPInput(true);
          },
          onError: (err: string) => {
            setLanError(err);
            setShowManualIPInput(true);
          },
        },
      });
      await server.start();
      const data = server.getQRData();
      if (data) setLanQrData(data);
      setLanServer(server);
    } catch (e) {
      setLanError(e instanceof Error ? e.message : String(e));
      setLanServerStatus("error");
      setShowManualIPInput(true);
    }
  }, []);

  const handleStartWithManualIP = useCallback(async () => {
    if (!lanManualServerIP) {
      setLanError(t("settings.syncLANFillAll"));
      return;
    }
    setLanError("");
    setLanServerStatus("starting");
    try {
      const deviceName = "ReadAny Mobile";
      const server = createLANServer({
        deviceName,
        events: {
          onStatusChange: setLanServerStatus,
          onError: setLanError,
        },
      });
      server.setManualIP(lanManualServerIP);
      await server.start();
      const data = server.getQRData();
      if (data) setLanQrData(data);
      setLanServer(server);
    } catch (e) {
      setLanError(e instanceof Error ? e.message : String(e));
      setLanServerStatus("error");
    }
  }, [lanManualServerIP, t]);

  const handleStopLanServer = useCallback(async () => {
    if (lanServer) {
      await lanServer.stop();
      setLanServer(null);
    }
    setLanServerStatus("idle");
    setLanQrData(null);
    setShowManualIPInput(false);
    setLanManualServerIP("");
  }, [lanServer]);

  const handleLanClientConnect = useCallback(async () => {
    if (!lanManualIP || !lanManualPort || !lanManualPairCode) {
      setLanError(t("settings.syncLANFillAll"));
      return;
    }
    setLanError("");
    Alert.alert(
      t("settings.syncLANImportWarningTitle"),
      t("settings.syncLANImportWarning"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.confirm"),
          style: "destructive",
          onPress: async () => {
            setLanConnectionState("connecting");
            try {
              const { createLANBackend } = require("@readany/core/sync/lan-backend");
              const serverUrl = `http://${lanManualIP}:${lanManualPort}`;
              const deviceName = Constants.deviceName || "Mobile";
              const backend = createLANBackend(serverUrl, lanManualPairCode, deviceName);
              const connected = await backend.testConnection();
              if (!connected) throw new Error(t("settings.syncLANConnectionFailed"));
              setLanConnectionState("connected");
              const result = await onSyncWithBackend(backend);
              if (!result || !result.success) {
                throw new Error(result?.error || t("settings.syncLANConnectionFailed"));
              }
              setLanConnectionState("idle");
            } catch (e) {
              setLanError(e instanceof Error ? e.message : String(e));
              setLanConnectionState("error");
            }
          },
        },
      ],
    );
  }, [lanManualIP, lanManualPort, lanManualPairCode, onSyncWithBackend, t]);

  const handleScanQRCode = useCallback(async () => {
    if (!permission) return;
    if (!permission.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        Alert.alert(t("settings.cameraPermission"), t("settings.cameraPermissionDesc"));
        return;
      }
    }
    scannerHandledRef.current = false;
    setScannerLocked(false);
    setShowScanner(true);
  }, [permission, requestPermission, t]);

  const onBarcodeScanned = useCallback(
    ({ data }: { data: string }) => {
      if (scannerHandledRef.current) return;
      scannerHandledRef.current = true;
      setScannerLocked(true);
      setShowScanner(false);
      try {
      const { parseLANQRData, createLANBackend } = require("@readany/core/sync/lan-backend");
      const qrData = parseLANQRData(data);
      if (qrData) {
        setLanManualIP(qrData.ip);
        setLanManualPort(qrData.port.toString());
        setLanManualPairCode(qrData.pairCode);
        Alert.alert(
          t("settings.syncLANImportWarningTitle"),
          t("settings.syncLANImportWarning"),
          [
            { text: t("common.cancel"), style: "cancel" },
            {
              text: t("common.confirm"),
              style: "destructive",
              onPress: () => {
                setTimeout(async () => {
                  try {
                    const url = `http://${qrData.ip}:${qrData.port}`;
                    const deviceName = Constants.deviceName || "Mobile";
                    const backend = createLANBackend(url, qrData.pairCode, deviceName);
                    setLanConnectionState("connecting");
                    setLanError("");
                    const connected = await backend.testConnection();
                    if (!connected) throw new Error(t("settings.syncLANConnectionFailed"));
                    setLanConnectionState("connected");
                    const result = await onSyncWithBackend(backend);
                    if (!result || !result.success) {
                      throw new Error(result?.error || t("settings.syncLANConnectionFailed"));
                    }
                    setLanConnectionState("idle");
                  } catch (err) {
                    setLanConnectionState("error");
                    setLanError(err instanceof Error ? err.message : String(err));
                  }
                }, 500);
              },
            },
          ],
        );
      } else {
        setLanError(t("settings.syncLANInvalidQR"));
      }
      } catch (e) {
        setLanError(e instanceof Error ? e.message : String(e));
      }
    },
    [onSyncWithBackend, t],
  );

  return (
    <>
      <View style={[styles.section, styles.sectionSpaced]}>
        <Text style={styles.sectionTitle}>{t("settings.syncConnection")}</Text>
        <View style={styles.card}>
          <Text style={styles.lanDesc}>{t("settings.syncLANDescFull")}</Text>

          {/* Mode selector */}
          <View style={styles.lanModeSelector}>
            <TouchableOpacity
              style={[styles.lanModeBtn, lanMode === "server" && styles.lanModeBtnActive]}
              onPress={() => setLanMode("server")}
            >
              <Text
                style={[
                  styles.lanModeBtnText,
                  lanMode === "server" && styles.lanModeBtnTextActive,
                ]}
              >
                {t("settings.syncLANServer")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.lanModeBtn, lanMode === "client" && styles.lanModeBtnActive]}
              onPress={() => setLanMode("client")}
            >
              <Text
                style={[
                  styles.lanModeBtnText,
                  lanMode === "client" && styles.lanModeBtnTextActive,
                ]}
              >
                {t("settings.syncLANClient")}
              </Text>
            </TouchableOpacity>
          </View>

          {lanMode === "server" ? (
            <View style={styles.lanServerSection}>
              <View style={styles.lanStatusRow}>
                <View
                  style={[
                    styles.lanStatusDot,
                    lanServerStatus === "running"
                      ? styles.lanStatusDotGreen
                      : lanServerStatus === "error"
                        ? styles.lanStatusDotRed
                        : undefined,
                  ]}
                />
                <Text style={styles.lanStatusText}>
                  {t(`settings.syncLANServerStatus.${lanServerStatus}`)}
                </Text>
              </View>

              {showManualIPInput && lanServerStatus !== "running" && (
                <View style={styles.manualIPCard}>
                  <Text style={styles.manualIPHint}>{t("settings.syncLANManualIPHint")}</Text>
                  <View style={styles.manualIPRow}>
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      value={lanManualServerIP}
                      onChangeText={setLanManualServerIP}
                      placeholder="192.168.1.100"
                      placeholderTextColor={colors.mutedForeground}
                      keyboardType="numeric"
                    />
                    <TouchableOpacity
                      style={[styles.primaryBtn, !lanManualServerIP && styles.btnDisabled]}
                      onPress={handleStartWithManualIP}
                      disabled={!lanManualServerIP}
                    >
                      <Text style={styles.primaryBtnText}>
                        {t("settings.syncLANServerStart")}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {lanQrData && (
                <View style={styles.lanQrSection}>
                  <View style={styles.lanQrPlaceholder}>
                    <QRCode value={JSON.stringify(lanQrData)} size={160} />
                  </View>
                  <Text style={styles.lanPairCodeLabel}>{t("settings.syncLANPairCode")}</Text>
                  <Text style={styles.lanPairCode}>{lanQrData.pairCode}</Text>
                  <View style={{ marginTop: 12, alignItems: "center", gap: 4 }}>
                    <Text style={styles.lanAddress}>
                      {t("settings.syncLANIP")}:{" "}
                      <Text
                        style={{ fontFamily: "SpaceMono_400Regular", color: colors.foreground }}
                      >
                        {lanQrData.ip}
                      </Text>
                    </Text>
                    <Text style={styles.lanAddress}>
                      {t("settings.syncLANPort")}:{" "}
                      <Text
                        style={{ fontFamily: "SpaceMono_400Regular", color: colors.foreground }}
                      >
                        {lanQrData.port}
                      </Text>
                    </Text>
                  </View>
                </View>
              )}

              {lanError && !showManualIPInput && (
                <Text style={styles.errorText}>{lanError}</Text>
              )}

              {!showManualIPInput && (
                <View style={styles.btnRow}>
                  {lanServerStatus !== "running" ? (
                    <TouchableOpacity
                      style={[styles.primaryBtn, styles.lanBtn]}
                      onPress={handleStartLanServer}
                      disabled={lanServerStatus === "starting"}
                    >
                      <Text style={styles.primaryBtnText}>
                        {lanServerStatus === "starting"
                          ? t("settings.syncLANServerStarting")
                          : t("settings.syncLANServerStart")}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[styles.outlineBtn, styles.lanBtn]}
                      onPress={handleStopLanServer}
                    >
                      <Text style={styles.outlineBtnText}>
                        {t("settings.syncLANServerStop")}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          ) : (
            <View style={styles.lanClientSection}>
              <TouchableOpacity
                style={[
                  styles.outlineBtn,
                  {
                    marginBottom: 16,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                  },
                ]}
                onPress={handleScanQRCode}
              >
                <Scan size={20} color={colors.primary} />
                <Text style={styles.outlineBtnText}>{t("settings.syncLANScanQR")}</Text>
              </TouchableOpacity>

              <View style={styles.separator}>
                <View style={styles.separatorLine} />
                <Text style={styles.separatorText}>{t("settings.syncLANManual")}</Text>
                <View style={styles.separatorLine} />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>{t("settings.syncLANIP")}</Text>
                <TextInput
                  style={styles.input}
                  value={lanManualIP}
                  onChangeText={setLanManualIP}
                  placeholder="192.168.1.100"
                  placeholderTextColor={colors.mutedForeground}
                />
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>{t("settings.syncLANPort")}</Text>
                <TextInput
                  style={styles.input}
                  value={lanManualPort}
                  onChangeText={setLanManualPort}
                  placeholder="8080"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="number-pad"
                />
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>{t("settings.syncLANPairCodeLabel")}</Text>
                <TextInput
                  style={styles.input}
                  value={lanManualPairCode}
                  onChangeText={setLanManualPairCode}
                  placeholder="123456"
                  placeholderTextColor={colors.mutedForeground}
                  maxLength={6}
                  keyboardType="number-pad"
                />
              </View>

              {lanError && <Text style={styles.errorText}>{lanError}</Text>}

              <TouchableOpacity
                style={[
                  styles.primaryBtn,
                  (lanConnectionState === "connecting" ||
                    isBusy ||
                    !lanManualIP ||
                    !lanManualPort ||
                    !lanManualPairCode) &&
                    styles.btnDisabled,
                ]}
                onPress={handleLanClientConnect}
                disabled={
                  lanConnectionState === "connecting" ||
                  isBusy ||
                  !lanManualIP ||
                  !lanManualPort ||
                  !lanManualPairCode
                }
              >
                <Text style={styles.primaryBtnText}>
                  {isBusy
                    ? t("settings.syncSyncing")
                    : lanConnectionState === "connecting"
                      ? t("settings.syncLANConnecting")
                      : t("settings.syncLANConnect")}
                </Text>
              </TouchableOpacity>

              {isBusy && progress && (
                <View style={[styles.progressContainer, { marginTop: 12 }]}>
                  <View style={styles.progressTrack}>
                    {progress.phase === "database" ? (
                      <Animated.View
                        style={[styles.progressFill, { width: "100%", opacity: pulseAnim }]}
                      />
                    ) : (
                      <View
                        style={[
                          styles.progressFill,
                          {
                            width: `${progress.totalFiles > 0 ? Math.round((progress.completedFiles / progress.totalFiles) * 100) : 0}%`,
                          },
                        ]}
                      />
                    )}
                  </View>
                  <Text style={styles.progressText}>
                    {progress.message || progressLabel()}
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>
      </View>

      {/* QR Scanner Modal */}
      <Modal visible={showScanner} animationType="slide" transparent={false}>
        <View style={styles.scannerContainer}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            onBarcodeScanned={showScanner && !scannerLocked ? onBarcodeScanned : undefined}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          />
          <View style={styles.scannerOverlay}>
            <View style={styles.scannerTarget} />
            <Text style={styles.scannerText}>
              {t("settings.syncLANScanHint") || "Scan the center QR code."}
            </Text>
            <TouchableOpacity
              style={styles.scannerCloseBtn}
              onPress={() => {
                scannerHandledRef.current = false;
                setScannerLocked(false);
                setShowScanner(false);
              }}
            >
              <Text style={styles.scannerCloseText}>
                {t("settings.syncClose") || "Close"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}
