/**
 * ReadSettings — reading view settings using shadcn components
 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useAppStore } from "@/stores/app-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useFontStore } from "@readany/core/stores";
import { type RubyMode, useRubyStore } from "@readany/core/stores/ruby-store";
import { Download, Loader2, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

export function ReadSettingsPanel() {
  const { t } = useTranslation();
  const { readSettings, updateReadSettings } = useSettingsStore();
  const customFonts = useFontStore((s) => s.fonts);
  const selectedFontId = useFontStore((s) => s.selectedFontId);
  const setSelectedFont = useFontStore((s) => s.setSelectedFont);

  const currentFontValue = selectedFontId ?? "system";

  const handleFontChange = (v: string) => {
    if (v === "system") {
      setSelectedFont(null);
    } else {
      setSelectedFont(v);
    }
  };

  return (
    <div className="space-y-6 p-4 pt-3">
      <section className="rounded-lg bg-muted/60 p-4">
        <h2 className="mb-4 text-sm font-medium text-foreground">{t("settings.reading_title")}</h2>
        <p className="mb-2 text-xs text-muted-foreground">{t("settings.reading_desc")}</p>
        <p className="mb-4 text-xs text-muted-foreground/60">{t("settings.readingNotice")}</p>

        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-foreground">{t("settings.viewMode")}</span>
            <Select
              value={readSettings.viewMode ?? "paginated"}
              onValueChange={(v) => updateReadSettings({ viewMode: v as "paginated" | "scroll" })}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="paginated">{t("settings.paginated")}</SelectItem>
                <SelectItem value="scroll">{t("settings.scroll")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-foreground">{t("settings.paginatedLayout")}</span>
            <Select
              value={readSettings.paginatedLayout ?? "double"}
              onValueChange={(v) =>
                updateReadSettings({ paginatedLayout: v as "single" | "double" })
              }
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="single">{t("settings.singlePage")}</SelectItem>
                <SelectItem value="double">{t("settings.doublePage")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Font */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-foreground">{t("settings.fontTheme")}</span>
            <Select value={currentFontValue} onValueChange={handleFontChange}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">{t("fonts.systemDefault", "系统默认")}</SelectItem>
                {customFonts.map((font) => (
                  <SelectItem key={font.id} value={font.id}>
                    {font.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Use book fonts */}
          <div className="flex items-center justify-between pt-1">
            <div>
              <span className="text-sm text-foreground">{t("settings.useBookFonts")}</span>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("settings.useBookFontsDesc")}
              </p>
            </div>
            <Switch
              checked={readSettings.useBookFonts !== false}
              onCheckedChange={(checked) => updateReadSettings({ useBookFonts: checked })}
            />
          </div>

          {/* Font Size */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-foreground">
                {t("settings.fontSize", { size: readSettings.fontSize })}
              </span>
              <span className="rounded bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {readSettings.fontSize}px
              </span>
            </div>
            <Slider
              min={12}
              max={64}
              step={1}
              value={[readSettings.fontSize]}
              onValueChange={([v]) => updateReadSettings({ fontSize: v })}
            />
          </div>

          {/* Line Height */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-foreground">
                {t("settings.lineHeight", { height: readSettings.lineHeight })}
              </span>
              <span className="rounded bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {readSettings.lineHeight}
              </span>
            </div>
            <Slider
              min={1.2}
              max={2.5}
              step={0.1}
              value={[readSettings.lineHeight]}
              onValueChange={([v]) => updateReadSettings({ lineHeight: v })}
            />
          </div>

          {/* Paragraph Spacing */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-foreground">{t("settings.paragraphSpacing")}</span>
              <span className="rounded bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {readSettings.paragraphSpacing}px
              </span>
            </div>
            <Slider
              min={0}
              max={32}
              step={2}
              value={[readSettings.paragraphSpacing]}
              onValueChange={([v]) => updateReadSettings({ paragraphSpacing: v })}
            />
          </div>
        </div>
      </section>

      {/* Ruby Annotation */}
      <RubySettingsSection />
    </div>
  );
}

/** Ruby annotation settings — dictionary management + per-book toggle */
function RubySettingsSection() {
  const { t } = useTranslation();
  const dictStates = useRubyStore((s) => s.dictStates);
  const appTabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const bookRubySettings = useRubyStore((s) => s.bookRubySettings);
  const setBookRuby = useRubyStore((s) => s.setBookRuby);
  const [downloading, setDownloading] = useState(false);

  // Find the current book from the active reader tab
  const activeTab = appTabs.find((tab) => tab.id === activeTabId && tab.type === "reader");
  const currentBookId = activeTab?.bookId ?? null;
  const currentRubyMode = currentBookId ? (bookRubySettings[currentBookId] ?? null) : null;

  const handleDownloadZh = useCallback(async () => {
    setDownloading(true);
    try {
      const { downloadChineseDict } = await import("@/lib/ruby/dict-service");
      await downloadChineseDict();
    } catch (err) {
      console.error("[Ruby] Download failed:", err);
    } finally {
      setDownloading(false);
    }
  }, []);

  const handleDeleteZh = useCallback(async () => {
    try {
      const { deleteChineseDict } = await import("@/lib/ruby/dict-service");
      await deleteChineseDict();
    } catch (err) {
      console.error("[Ruby] Delete failed:", err);
    }
  }, []);

  const handleModeChange = useCallback(
    (value: string) => {
      if (!currentBookId) return;
      const mode = value === "off" ? null : (value as RubyMode);
      setBookRuby(currentBookId, mode);
    },
    [currentBookId, setBookRuby],
  );

  const zhReady = dictStates.zh.status === "ready";

  return (
    <section className="rounded-lg bg-muted/60 p-4">
      <h2 className="mb-4 text-sm font-medium text-foreground">{t("ruby.title")}</h2>
      <p className="mb-4 text-xs text-muted-foreground">{t("ruby.desc")}</p>

      <div className="space-y-4">
        {/* Dictionary status */}
        <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
          <div>
            <span className="text-sm text-foreground">{t("ruby.dictZh")}</span>
            <span className="ml-2 text-xs text-muted-foreground">~2.5MB</span>
          </div>
          {zhReady ? (
            <button
              type="button"
              onClick={handleDeleteZh}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-3 w-3" />
              {t("common.delete")}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleDownloadZh}
              disabled={downloading || dictStates.zh.status === "downloading"}
              className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {downloading || dictStates.zh.status === "downloading" ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {dictStates.zh.progress ? `${dictStates.zh.progress}%` : t("common.loading")}
                </>
              ) : (
                <>
                  <Download className="h-3 w-3" />
                  {t("ruby.download")}
                </>
              )}
            </button>
          )}
        </div>

        {/* Mode selector (only when dict is ready and a book is open) */}
        {zhReady && currentBookId && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-foreground">{t("ruby.mode")}</span>
            <Select value={currentRubyMode || "off"} onValueChange={handleModeChange}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">{t("ruby.off")}</SelectItem>
                <SelectItem value="zh-pinyin">{t("ruby.pinyin")}</SelectItem>
                <SelectItem value="zh-zhuyin">{t("ruby.zhuyin")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {dictStates.zh.error && <p className="text-xs text-destructive">{dictStates.zh.error}</p>}
      </div>
    </section>
  );
}
