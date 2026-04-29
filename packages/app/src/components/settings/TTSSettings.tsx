import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  DEFAULT_SYSTEM_VOICE_VALUE,
  findSystemVoiceLabel,
  getSystemVoiceOptions,
  groupSystemVoiceOptions,
  resolveSystemVoiceValue,
} from "@/lib/tts/system-voices";
import { previewTTSConfig, stopTTSPreview } from "@/lib/tts/tts-preview";
import { DASHSCOPE_VOICES, EDGE_TTS_VOICES, getSystemVoices } from "@/lib/tts/tts-service";
import type { TTSEngine } from "@/lib/tts/tts-service";
import { useTTSStore } from "@/stores/tts-store";
import { getLocaleDisplayLabel, groupEdgeTTSVoices } from "@readany/core/tts";
import { cn } from "@readany/core/utils";
import { Headphones, Mic, Play, type Volume2, Zap } from "lucide-react";
/**
 * TTSSettings — TTS configuration panel in the settings dialog.
 *
 * Uses shadcn/ui components: Select, Slider, Button.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export function TTSSettings() {
  const { t, i18n } = useTranslation();
  const config = useTTSStore((s) => s.config);
  const updateConfig = useTTSStore((s) => s.updateConfig);
  const stop = useTTSStore((s) => s.stop);

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    const loadVoices = () => setVoices(getSystemVoices());
    loadVoices();
    window.speechSynthesis?.addEventListener?.("voiceschanged", loadVoices);
    return () => window.speechSynthesis?.removeEventListener?.("voiceschanged", loadVoices);
  }, []);

  // Group Edge TTS voices by language
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

  useEffect(() => stopTTSPreview, []);

  const handlePreview = async () => {
    stop();
    await previewTTSConfig(t("tts.testText", "这是一段测试文本"), config);
  };

  const engines: { id: TTSEngine; icon: typeof Volume2; label: string; desc: string }[] = [
    { id: "edge", icon: Zap, label: t("tts.edgeEngine"), desc: t("tts.edgeEngineDesc") },
    {
      id: "system",
      icon: Headphones,
      label: t("tts.systemEngine"),
      desc: t("tts.systemEngineDesc"),
    },
    {
      id: "dashscope",
      icon: Mic,
      label: t("tts.dashscopeEngine"),
      desc: t("tts.dashscopeEngineDesc"),
    },
  ];

  return (
    <div className="space-y-4 p-4 pt-3">
      <section className="rounded-lg bg-muted/60 p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-foreground">{t("tts.settingsTitle")}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{t("tts.settingsDesc")}</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="shrink-0"
            onClick={handlePreview}
          >
            <Play className="mr-1.5 h-3.5 w-3.5" />
            {t("common.preview", "试听")}
          </Button>
        </div>

        <div className="space-y-5">
          {/* Engine selection — 3 engines */}
          <div className="space-y-2">
            <span className="text-sm text-foreground">{t("tts.engine")}</span>
            <div className="grid grid-cols-3 gap-2">
              {engines.map(({ id, icon: Icon, label, desc }) => (
                <button
                  key={id}
                  type="button"
                  className={cn(
                    "rounded-lg border px-3 py-2.5 text-left transition-colors",
                    config.engine === id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40",
                  )}
                  onClick={() => updateConfig({ engine: id })}
                >
                  <div className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium">{label}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Rate */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-foreground">{t("tts.rate")}</span>
              <span className="rounded bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {config.rate.toFixed(1)}x
              </span>
            </div>
            <Slider
              min={0.5}
              max={2.0}
              step={0.1}
              value={[config.rate]}
              onValueChange={([v]) => updateConfig({ rate: Math.round(v * 10) / 10 })}
            />
          </div>

          {/* Pitch (system only) */}
          {config.engine === "system" && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm text-foreground">{t("tts.pitch")}</span>
                <span className="rounded bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {config.pitch.toFixed(1)}
                </span>
              </div>
              <Slider
                min={0.5}
                max={2.0}
                step={0.1}
                value={[config.pitch]}
                onValueChange={([v]) => updateConfig({ pitch: Math.round(v * 10) / 10 })}
              />
            </div>
          )}

          {/* Voice selection — engine-specific */}
          {config.engine === "edge" && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">{t("tts.voice")}</span>
              <Select
                value={config.edgeVoice}
                onValueChange={(v) => updateConfig({ edgeVoice: v })}
              >
                <SelectTrigger className="w-[240px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {edgeVoiceGroups.map(([lang, langVoices]) => (
                    <div key={lang}>
                      <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                        {getLocaleDisplayLabel(lang, displayLocale)}
                      </div>
                      {langVoices.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.name}
                        </SelectItem>
                      ))}
                    </div>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {config.engine === "system" && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">{t("tts.voice")}</span>
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
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder={t("tts.defaultVoice")} />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
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
          )}

          {config.engine === "dashscope" && (
            <>
              {/* DashScope voice */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground">{t("tts.voice")}</span>
                <Select
                  value={config.dashscopeVoice}
                  onValueChange={(v) => updateConfig({ dashscopeVoice: v })}
                >
                  <SelectTrigger className="w-[200px]">
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

              {/* DashScope API Key */}
              <div className="space-y-2">
                <span className="text-sm text-foreground">{t("tts.apiKey")}</span>
                <PasswordInput
                  placeholder={t("tts.apiKeyPlaceholder")}
                  value={config.dashscopeApiKey}
                  onChange={(e) => updateConfig({ dashscopeApiKey: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  {t("tts.apiKeyHint")}{" "}
                  <a
                    href="https://bailian.console.aliyun.com/cn-beijing/?tab=model#/api-key"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline hover:text-primary/80"
                  >
                    {t("tts.getApiKey")}
                  </a>
                </p>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
