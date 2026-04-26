import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DASHSCOPE_VOICES, EDGE_TTS_VOICES, MIMO_VOICES, getSystemVoices } from "@/lib/tts/tts-service";
import {
  DEFAULT_SYSTEM_VOICE_VALUE,
  findSystemVoiceLabel,
  getSystemVoiceOptions,
  groupSystemVoiceOptions,
  resolveSystemVoiceValue,
} from "@/lib/tts/system-voices";
import type { TTSEngine } from "@/lib/tts/tts-service";
import { useReaderStore } from "@/stores/reader-store";
import { useTTSStore } from "@/stores/tts-store";
import { getLocaleDisplayLabel, groupEdgeTTSVoices } from "@readany/core/tts";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Headphones,
  Minus,
  Pause,
  Play,
  Plus,
  Square,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

interface FooterBarProps {
  tabId: string;
  totalPages: number;
  currentPage: number;
  isVisible: boolean;
  onPrev: () => void;
  onNext: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  /** TTS mode */
  showTTS?: boolean;
  onTTSClose?: () => void;
}

export function FooterBar({
  tabId,
  totalPages,
  currentPage,
  isVisible,
  onPrev,
  onNext,
  onMouseEnter,
  onMouseLeave,
  showTTS = false,
  onTTSClose,
}: FooterBarProps) {
  const { t, i18n } = useTranslation();
  const tab = useReaderStore((s) => s.tabs[tabId]);

  const playState = useTTSStore((s) => s.playState);
  const config = useTTSStore((s) => s.config);
  const pause = useTTSStore((s) => s.pause);
  const resume = useTTSStore((s) => s.resume);
  const stop = useTTSStore((s) => s.stop);
  const updateConfig = useTTSStore((s) => s.updateConfig);

  const [ttsExpanded, setTtsExpanded] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    const loadVoices = () => setVoices(getSystemVoices());
    loadVoices();
    window.speechSynthesis?.addEventListener?.("voiceschanged", loadVoices);
    return () => window.speechSynthesis?.removeEventListener?.("voiceschanged", loadVoices);
  }, []);

  const displayLocale = i18n.resolvedLanguage || i18n.language;
  const edgeVoiceGroups = useMemo(() => groupEdgeTTSVoices(EDGE_TTS_VOICES), []);
  const systemVoiceOptions = useMemo(() => getSystemVoiceOptions(voices), [voices]);
  const systemVoiceGroups = useMemo(
    () => groupSystemVoiceOptions(systemVoiceOptions),
    [systemVoiceOptions],
  );
  const selectedSystemVoiceValue = useMemo(
    () => resolveSystemVoiceValue(config.voiceName, systemVoiceOptions),
    [config.voiceName, systemVoiceOptions],
  );

  // Collapse settings when TTS is hidden
  useEffect(() => {
    if (!showTTS) setTtsExpanded(false);
  }, [showTTS]);

  const progress = tab?.progress ?? 0;
  const pct = Math.round(progress * 100);

  const adjustRate = (delta: number) => {
    const newRate = Math.round(Math.max(0.5, Math.min(2.0, config.rate + delta)) * 10) / 10;
    updateConfig({ rate: newRate });
  };

  const handleTTSStop = () => {
    stop();
    onTTSClose?.();
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={`absolute bottom-0 left-0 right-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm shadow-[0_-1px_3px_rgba(0,0,0,0.05)] transition-all duration-300 ${
          isVisible
            ? "translate-y-0 opacity-100 pointer-events-auto"
            : "translate-y-full opacity-0 pointer-events-none"
        }`}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {/* TTS expanded settings — above the main bar */}
        {showTTS && ttsExpanded && (
          <div className="border-b border-border/40 px-4 py-3 space-y-3 animate-in slide-in-from-bottom-1 duration-150">
            {/* Engine selection */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground w-16 shrink-0">{t("tts.engine")}</span>
              <div className="flex gap-1">
                {(["edge", "system", "dashscope", "mimo"] as TTSEngine[]).map((eng) => (
                  <Button
                    key={eng}
                    variant={config.engine === eng ? "default" : "secondary"}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => updateConfig({ engine: eng })}
                  >
                    {eng === "system"
                      ? t("tts.systemEngine")
                      : eng === "edge"
                        ? t("tts.edgeEngine")
                        : eng === "dashscope"
                          ? t("tts.dashscopeEngine")
                          : t("tts.mimoEngine", "MiMo TTS")}
                  </Button>
                ))}
              </div>
            </div>

            {/* Voice selection */}
            {config.engine === "edge" ? (
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-16 shrink-0">
                  {t("tts.voice")}
                </span>
                <Select
                  value={config.edgeVoice}
                  onValueChange={(v) => updateConfig({ edgeVoice: v })}
                >
                  <SelectTrigger className="h-7 flex-1 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    {edgeVoiceGroups.map(([lang, voices]) => (
                      <div key={lang}>
                        <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                          {getLocaleDisplayLabel(lang, displayLocale)}
                        </div>
                        {voices.map((v) => (
                          <SelectItem key={v.id} value={v.id}>
                            {v.name}
                          </SelectItem>
                        ))}
                      </div>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : config.engine === "system" ? (
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-16 shrink-0">
                  {t("tts.voice")}
                </span>
                <Select
                  value={selectedSystemVoiceValue}
                  onValueChange={(v) => {
                    if (v === DEFAULT_SYSTEM_VOICE_VALUE) {
                      updateConfig({ voiceName: "", systemVoiceLabel: "" });
                      return;
                    }
                    updateConfig({
                      voiceName: v,
                      systemVoiceLabel: findSystemVoiceLabel(v, systemVoiceOptions),
                    });
                  }}
                >
                  <SelectTrigger className="h-7 flex-1 text-xs">
                    <SelectValue placeholder={t("tts.defaultVoice")} />
                  </SelectTrigger>
                  <SelectContent className="max-h-[220px]">
                    <SelectItem value={DEFAULT_SYSTEM_VOICE_VALUE}>
                    {t("tts.defaultVoice")}
                  </SelectItem>
                  {systemVoiceGroups.map(([lang, langVoices]) => (
                    <div key={lang}>
                      <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                          {getLocaleDisplayLabel(lang, displayLocale)}
                      </div>
                      {langVoices.map((voice) => (
                        <SelectItem key={voice.id} value={voice.id}>
                            {voice.label}
                          </SelectItem>
                        ))}
                      </div>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : config.engine === "dashscope" ? (
              <>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-16 shrink-0">
                    {t("tts.voice")}
                  </span>
                  <Select
                    value={config.dashscopeVoice}
                    onValueChange={(v) => updateConfig({ dashscopeVoice: v })}
                  >
                    <SelectTrigger className="h-7 flex-1 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DASHSCOPE_VOICES.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-16 shrink-0">API Key</span>
                  <PasswordInput
                    className="h-7 flex-1 text-xs"
                    placeholder={t("tts.apiKeyPlaceholder")}
                    value={config.dashscopeApiKey}
                    onChange={(e) => updateConfig({ dashscopeApiKey: e.target.value })}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-16 shrink-0">
                    {t("tts.voice")}
                  </span>
                  <Select
                    value={config.mimoVoice}
                    onValueChange={(v) => updateConfig({ mimoVoice: v })}
                  >
                    <SelectTrigger className="h-7 flex-1 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MIMO_VOICES.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-16 shrink-0">API Key</span>
                  <PasswordInput
                    className="h-7 flex-1 text-xs"
                    placeholder={t("tts.mimoApiKeyPlaceholder", "Enter MiMo API Key")}
                    value={config.mimoApiKey}
                    onChange={(e) => updateConfig({ mimoApiKey: e.target.value })}
                  />
                </div>
              </>
            )}
          </div>
        )}

        {/* Main footer bar */}
        <div className="flex h-10 items-center justify-between px-2">
          {/* Left: prev button */}
          <button
            type="button"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
            onClick={onPrev}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          {/* Center: page info + TTS controls when active */}
          <div className="flex items-center gap-1">
            {/* Page info — always visible */}
            <span className="text-xs text-muted-foreground tabular-nums shrink-0">
              {totalPages > 0 ? `${currentPage} / ${totalPages}` : `${pct}%`}
            </span>

            {showTTS && (
              <>
                <div className="mx-1 h-4 w-px bg-border/50" />

                {/* Loading spinner or state indicator */}
                {playState === "loading" ? (
                  <div className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                ) : (
                  <Headphones className="h-3 w-3 text-primary shrink-0" />
                )}

                {/* Rate control */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => adjustRate(-0.1)}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{t("tts.slower")}</TooltipContent>
                </Tooltip>

                <span className="w-7 text-center text-[10px] tabular-nums text-muted-foreground">
                  {config.rate.toFixed(1)}x
                </span>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => adjustRate(0.1)}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{t("tts.faster")}</TooltipContent>
                </Tooltip>

                <div className="mx-1 h-4 w-px bg-border/50" />

                {/* Play/Pause */}
                <Button
                  size="icon"
                  className="h-7 w-7 rounded-full"
                  onClick={() => {
                    if (playState === "playing") pause();
                    else if (playState === "paused") resume();
                  }}
                  disabled={playState === "loading" || playState === "stopped"}
                >
                  {playState === "playing" ? (
                    <Pause className="h-3 w-3" />
                  ) : (
                    <Play className="h-3 w-3 ml-0.5" />
                  )}
                </Button>

                {/* Stop */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleTTSStop}>
                      <Square className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{t("common.stop")}</TooltipContent>
                </Tooltip>

                <div className="mx-1 h-4 w-px bg-border/50" />

                {/* Settings toggle */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => setTtsExpanded(!ttsExpanded)}
                    >
                      {ttsExpanded ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronUp className="h-3 w-3" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{t("common.settings")}</TooltipContent>
                </Tooltip>
              </>
            )}
          </div>

          {/* Right: next button */}
          <button
            type="button"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
            onClick={onNext}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </TooltipProvider>
  );
}
