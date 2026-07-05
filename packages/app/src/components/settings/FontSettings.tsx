import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  createCustomFontFamily,
  generateFontId,
  saveFontFile,
  useFontStore,
} from "@readany/core/stores";
import type { CustomFont } from "@readany/core/types/font";
import { PRESET_FONTS } from "@readany/core/types/font";
import { Download, FileText, Globe, Trash2 } from "lucide-react";
/**
 * FontSettings — custom font management for desktop
 */
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

export function FontSettings() {
  const { t, i18n } = useTranslation();

  const fonts = useFontStore((s) => s.fonts);
  const addFont = useFontStore((s) => s.addFont);
  const removeFont = useFontStore((s) => s.removeFont);

  const [importing, setImporting] = useState(false);
  const [nameModalOpen, setNameModalOpen] = useState(false);
  const [urlModalOpen, setUrlModalOpen] = useState(false);
  const [pendingFontFile, setPendingFontFile] = useState<{ path: string; name: string } | null>(
    null,
  );
  const [fontNameInput, setFontNameInput] = useState("");

  const [remoteUrl, setRemoteUrl] = useState("");
  const [remoteUrlWoff2, setRemoteUrlWoff2] = useState("");
  const [remoteFontName, setRemoteFontName] = useState("");

  // Track which presets are already added
  const installedPresetIds = new Set(
    fonts.filter((f) => f.id.startsWith("preset-")).map((f) => f.id),
  );
  const availablePresetFonts = PRESET_FONTS.filter((preset) => !installedPresetIds.has(preset.id));

  const handleAddPreset = useCallback(
    (preset: (typeof PRESET_FONTS)[number]) => {
      const font: CustomFont = {
        id: preset.id,
        name: i18n.language === "zh" ? preset.name : preset.nameEn,
        fileName: `preset-${preset.id}.woff2`,
        fontFamily: preset.fontFamily,
        format: preset.format,
        addedAt: Date.now(),
        source: "remote",
        remoteCssUrl: preset.remoteCssUrl,
        remoteUrlWoff2: preset.remoteUrlWoff2,
        remoteUrl: preset.remoteUrl,
      };
      addFont(font, { select: true });
    },
    [addFont, i18n.language],
  );

  const handleImport = useCallback(async () => {
    setImporting(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const result = await open({
        multiple: false,
        filters: [{ name: "Font Files", extensions: ["ttf", "otf", "woff", "woff2"] }],
      });

      if (!result) {
        setImporting(false);
        return;
      }

      const filePath = typeof result === "string" ? result : (result as string[])[0];
      if (!filePath) {
        setImporting(false);
        return;
      }

      const fileName = filePath.split(/[/\\]/).pop() || "font.ttf";
      const nameWithoutExt = fileName.replace(/\.(ttf|otf|woff|woff2)$/i, "");

      setPendingFontFile({ path: filePath, name: fileName });
      setFontNameInput(nameWithoutExt);
      setNameModalOpen(true);
      setImporting(false);
    } catch (err) {
      console.error("[FontSettings] Pick error:", err);
      setImporting(false);
    }
  }, []);

  const handleConfirmImport = useCallback(async () => {
    if (!fontNameInput.trim() || !pendingFontFile) return;

    setNameModalOpen(false);
    setImporting(true);

    try {
      const {
        filePath,
        fileName: savedName,
        size,
      } = await saveFontFile(pendingFontFile.path, fontNameInput.trim(), pendingFontFile.name);

      const id = generateFontId();
      const font: CustomFont = {
        id,
        name: fontNameInput.trim(),
        fileName: savedName,
        filePath,
        fontFamily: createCustomFontFamily(id),
        format:
          (savedName.split(".").pop()?.toLowerCase() as "ttf" | "otf" | "woff" | "woff2") || "ttf",
        size,
        addedAt: Date.now(),
        source: "local",
      };

      addFont(font, { select: true });
    } catch (err) {
      console.error("[FontSettings] Import error:", err);
    } finally {
      setImporting(false);
      setPendingFontFile(null);
      setFontNameInput("");
    }
  }, [fontNameInput, pendingFontFile, addFont]);

  const handleImportRemote = useCallback(async () => {
    if (!remoteFontName.trim()) return;
    if (!remoteUrl.trim() && !remoteUrlWoff2.trim()) return;

    setUrlModalOpen(false);
    setImporting(true);

    try {
      const id = generateFontId();
      const url = remoteUrl.trim();
      const woff2Url = remoteUrlWoff2.trim();
      const format = woff2Url ? "woff2" : url.endsWith(".woff2") ? "woff2" : "woff";

      const font: CustomFont = {
        id,
        name: remoteFontName.trim(),
        fileName: `remote-${Date.now()}.${format}`,
        fontFamily: createCustomFontFamily(id),
        format,
        addedAt: Date.now(),
        source: "remote",
        remoteUrl: url || undefined,
        remoteUrlWoff2: woff2Url || undefined,
      };

      addFont(font, { select: true });
    } catch (err) {
      console.error("[FontSettings] Import remote error:", err);
    } finally {
      setImporting(false);
      setRemoteUrl("");
      setRemoteUrlWoff2("");
      setRemoteFontName("");
    }
  }, [remoteFontName, remoteUrl, remoteUrlWoff2, addFont]);

  const handleDelete = useCallback(
    (font: CustomFont) => {
      removeFont(font.id);
    },
    [removeFont],
  );

  const formatSize = (bytes?: number): string => {
    if (!bytes) return "-";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-6 p-4 pt-3">
      <section className="rounded-lg bg-muted/60 p-4">
        <h2 className="mb-3 text-sm font-medium text-foreground">
          {t("fonts.title", "自定义字体")}
        </h2>
        <p className="mb-2 text-xs text-muted-foreground">
          {t("fonts.desc", "导入自定义字体，在阅读器中使用。支持 TTF、OTF、WOFF、WOFF2 格式。")}
        </p>
        <p className="mb-4 text-xs text-muted-foreground/80">
          {t(
            "fonts.importHint",
            "支持 TTF / OTF / WOFF / WOFF2，推荐 WOFF2（同款字体体积约为 TTF 的 1/3）",
          )}
        </p>

        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={handleImport}
            disabled={importing}
            className="flex items-center gap-1.5"
          >
            <FileText className="h-3.5 w-3.5" />
            {t("fonts.fromFile", "本地文件")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setUrlModalOpen(true)}
            disabled={importing}
            className="flex items-center gap-1.5"
          >
            <Globe className="h-3.5 w-3.5" />
            {t("fonts.fromUrl", "在线链接")}
          </Button>
        </div>
      </section>

      {/* Preset fonts */}
      {availablePresetFonts.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">
            {t("fonts.presets", "推荐字体（在线，点击即可添加）")}
          </h3>
          {availablePresetFonts.map((preset) => (
            <div
              key={preset.id}
              className="flex items-center justify-between rounded-lg border border-border bg-card p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {i18n.language === "zh" ? preset.name : preset.nameEn}
                  </span>
                  <Badge variant="secondary" className="text-xs px-1.5 py-0">
                    {preset.license}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                  {i18n.language === "zh" ? preset.description : preset.descriptionEn}
                </p>
              </div>
              <Button
                size="sm"
                className="ml-3 flex-shrink-0 gap-1.5"
                onClick={() => handleAddPreset(preset)}
              >
                <>
                  <Download className="h-3.5 w-3.5" />
                  {t("fonts.add", "添加")}
                </>
              </Button>
            </div>
          ))}
        </section>
      )}

      {/* Font list */}
      <section className="space-y-2">
        {fonts.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
            <FileText className="mb-2 h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{t("fonts.empty", "暂无自定义字体")}</p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              {t("fonts.emptyHint", "点击上方按钮导入字体文件")}
            </p>
          </div>
        ) : (
          fonts.map((font) => (
            <div
              key={font.id}
              className="flex items-start justify-between rounded-lg border border-border bg-card p-3"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{font.name}</span>
                  {font.source === "remote" && (
                    <Badge
                      variant="secondary"
                      className="flex items-center gap-1 px-1.5 py-0 text-xs"
                    >
                      <Globe className="h-3 w-3" />
                      {t("fonts.remote", "在线")}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{font.format.toUpperCase()}</span>
                  <span>·</span>
                  <span>{formatSize(font.size)}</span>
                </div>
                {/* Preview */}
                <div className="mt-2 rounded border border-border bg-muted/40 px-2.5 py-1.5">
                  <span className="text-xs text-foreground" style={{ fontFamily: font.fontFamily }}>
                    {t("fonts.preview", "预览文字：阅读改变世界 The quick brown fox")}
                  </span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="ml-2 h-7 w-7 flex-shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => handleDelete(font)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))
        )}
      </section>

      {/* Name modal for local import */}
      <Dialog open={nameModalOpen} onOpenChange={setNameModalOpen}>
        <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{t("fonts.nameFont", "字体名称")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("fonts.nameFontDesc", "请输入字体的显示名称")}
          </p>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              {t("fonts.name", "字体名称")}
            </label>
            <Input
              value={fontNameInput}
              onChange={(e) => setFontNameInput(e.target.value)}
              placeholder={t("fonts.namePlaceholder", "输入显示名称")}
              onKeyDown={(e) => e.key === "Enter" && handleConfirmImport()}
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                setNameModalOpen(false);
                setPendingFontFile(null);
                setFontNameInput("");
              }}
            >
              {t("common.cancel", "取消")}
            </Button>
            <Button onClick={handleConfirmImport} disabled={!fontNameInput.trim()}>
              {t("fonts.import", "导入")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* URL modal for remote import */}
      <Dialog open={urlModalOpen} onOpenChange={setUrlModalOpen}>
        <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{t("fonts.fromUrl", "在线链接")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("fonts.urlHint", "输入字体 CDN 链接")}</p>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                {t("fonts.name", "字体名称")}
              </label>
              <Input
                value={remoteFontName}
                onChange={(e) => setRemoteFontName(e.target.value)}
                placeholder={t("fonts.namePlaceholder", "输入显示名称")}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                {t("fonts.urlWoff2", "WOFF2 链接")}
              </label>
              <Input
                value={remoteUrlWoff2}
                onChange={(e) => setRemoteUrlWoff2(e.target.value)}
                placeholder="https://example.com/font.woff2"
                type="url"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                {t("fonts.urlWoff", "WOFF 链接 (备选)")}
              </label>
              <Input
                value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
                placeholder="https://example.com/font.woff"
                type="url"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                setUrlModalOpen(false);
                setRemoteUrl("");
                setRemoteUrlWoff2("");
                setRemoteFontName("");
              }}
            >
              {t("common.cancel", "取消")}
            </Button>
            <Button
              onClick={handleImportRemote}
              disabled={!remoteFontName.trim() || (!remoteUrl.trim() && !remoteUrlWoff2.trim())}
            >
              {t("fonts.import", "导入")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
