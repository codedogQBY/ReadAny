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
import { DASHSCOPE_VOICES, MIMO_VOICES, getSystemVoices } from "@/lib/tts/tts-service";
import {
  DEFAULT_SYSTEM_VOICE_VALUE,
  findSystemVoiceLabel,
  getSystemVoiceOptions,
  groupSystemVoiceOptions,
  resolveSystemVoiceValue,
} from "@/lib/tts/system-voices";
import type { TTSEngine } from "@/lib/tts/tts-service";
import { useTTSStore } from "@/stores/tts-store";
import { TTSSleepTimerPanel } from "@/components/tts/TTSSleepTimerPanel";
import { getLocaleDisplayLabel } from "@readany/core/tts";
import { cn } from "@readany/core/utils";
import { ChevronDown, ChevronUp, Headphones, Minus, Pause, Play, Plus, Square } from "lucide-react";
/**
 * TTSControls — Floating TTS playback control bar.
 *
 * Appears at bottom of reader when TTS is active.
 * Uses shadcn/ui: Button, Select, Slider, Tooltip.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

interface TTSControlsProps {
  onClose: () => void;
  className?: string;
}

export function TTSControls({ onClose, className }: TTSControlsProps) {
  const { t, i18n } = useTranslation();
  const playState = useTTSStore((s) => s.playState);
  const config = useTTSStore((s) => s.config);
  const pause = useTTSStore((s) => s.pause);
  const resume = useTTSStore((s) => s.resume);
  const stop = useTTSStore((s) => s.stop);
  const updateConfig = useTTSStore((s) => s.updateConfig);

  const [expanded, setExpanded] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    const loadVoices = () => setVoices(getSystemVoices());
    loadVoices();
    window.speechSynthesis?.addEventListener?.("voiceschanged", loadVoices);
    return () => window.speechSynthesis?.removeEventListener?.("voiceschanged", loadVoices);
  }, []);

  const displayLocale = i18n.resolvedLanguage || i18n.language;
  const systemVoiceOptions = useMemo(() => getSystemVoiceOptions(voices), [voices]);
  const systemVoiceGroups = useMemo(
    () => groupSystemVoiceOptions(systemVoiceOptions),
    [systemVoiceOptions],
  );
  const selectedSystemVoiceValue = useMemo(
    () => resolveSystemVoiceValue(config.voiceName, systemVoiceOptions),
    [config.voiceName, systemVoiceOptions],
  );

  const handleStop = () => {
    stop();
    onClose();
  };

  const adjustRate = (delta: number) => {
    const newRate = Math.round(Math.max(0.5, Math.min(2.0, config.rate + delta)) * 10) / 10;
    updateConfig({ rate: newRate });
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          "absolute left-0 right-0 z-[60] flex flex-col border-t border-border bg-background/98 shadow-lg backdrop-blur-sm animate-in slide-in-from-bottom-2 duration-200 transition-[bottom] duration-300",
          className || "bottom-0",
        )}
      >
        {/* Expanded settings panel */}
        {expanded && (
          <div className="border-b border-border/40 px-4 py-3 space-y-3">
            {/* Engine selection */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground w-16 shrink-0">{t("tts.engine")}</span>
              <div className="flex gap-1">
                {(["system", "dashscope", "mimo"] as TTSEngine[]).map((eng) => (
                  <Button
                    key={eng}
                    variant={config.engine === eng ? "default" : "secondary"}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => updateConfig({ engine: eng })}
                  >
                    {eng === "system"
                      ? t("tts.systemEngine")
                      : eng === "dashscope"
                        ? t("tts.dashscopeEngine")
                        : t("tts.mimoEngine", "MiMo TTS")}
                  </Button>
                ))}
              </div>
            </div>

            {/* Voice selection */}
            {config.engine === "system" ? (
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

            <TTSSleepTimerPanel />
          </div>
        )}

        {/* Main controls bar */}
        <div className="flex h-11 items-center justify-between px-3">
          {/* Left: icon + state label */}
          <div className="flex items-center gap-2">
            <Headphones className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs text-muted-foreground">
              {playState === "loading"
                ? t("tts.loading")
                : playState === "playing"
                  ? t("tts.playing")
                  : playState === "paused"
                    ? t("tts.paused")
                    : t("tts.stopped")}
            </span>
          </div>

          {/* Center: playback controls */}
          <div className="flex items-center gap-1">
            {/* Rate control */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => adjustRate(-0.1)}
                >
                  <Minus className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("tts.slower")}</TooltipContent>
            </Tooltip>

            <span className="w-8 text-center text-xs tabular-nums text-muted-foreground">
              {config.rate.toFixed(1)}x
            </span>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => adjustRate(0.1)}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("tts.faster")}</TooltipContent>
            </Tooltip>

            <div className="mx-1.5 h-4 w-px bg-border/50" />

            {/* Play/Pause */}
            <Button
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={() => {
                if (playState === "playing") pause();
                else if (playState === "paused") resume();
              }}
              disabled={playState === "loading" || playState === "stopped"}
            >
              {playState === "playing" ? (
                <Pause className="h-3.5 w-3.5" />
              ) : (
                <Play className="h-3.5 w-3.5 ml-0.5" />
              )}
            </Button>

            {/* Stop */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleStop}>
                  <Square className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("common.stop")}</TooltipContent>
            </Tooltip>
          </div>

          {/* Right: expand/collapse settings */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronUp className="h-3.5 w-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("common.settings")}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
