/**
 * TTSSettings — TTS configuration panel in the settings dialog.
 *
 * Uses shadcn/ui components: Select, Slider, Input, Button.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTTSStore } from "@/stores/tts-store";
import {
  getBrowserVoices,
  DASHSCOPE_VOICES,
  EDGE_TTS_VOICES,
} from "@/lib/tts/tts-service";
import type { TTSEngine } from "@/lib/tts/tts-service";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { Volume2, Zap, Globe, Mic } from "lucide-react";

export function TTSSettings() {
  const { t } = useTranslation();
  const config = useTTSStore((s) => s.config);
  const updateConfig = useTTSStore((s) => s.updateConfig);

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    const loadVoices = () => setVoices(getBrowserVoices());
    loadVoices();
    window.speechSynthesis?.addEventListener?.("voiceschanged", loadVoices);
    return () => window.speechSynthesis?.removeEventListener?.("voiceschanged", loadVoices);
  }, []);

  // Group Edge TTS voices by language
  const edgeVoicesByLang = useMemo(() => {
    const map = new Map<string, typeof EDGE_TTS_VOICES>();
    for (const v of EDGE_TTS_VOICES) {
      const group = map.get(v.lang) || [];
      group.push(v);
      map.set(v.lang, group);
    }
    return map;
  }, []);

  const engines: { id: TTSEngine; icon: typeof Volume2; label: string; desc: string }[] = [
    { id: "edge", icon: Zap, label: t("tts.edgeEngine"), desc: t("tts.edgeEngineDesc") },
    { id: "browser", icon: Globe, label: t("tts.browserEngine"), desc: t("tts.browserEngineDesc") },
    { id: "dashscope", icon: Mic, label: t("tts.dashscopeEngine"), desc: t("tts.dashscopeEngineDesc") },
  ];

  return (
    <div className="space-y-4 p-4 pt-3">
      <section className="rounded-lg bg-muted/60 p-4">
        <h2 className="mb-4 text-sm font-medium text-neutral-900">{t("tts.settingsTitle")}</h2>
        <p className="mb-4 text-xs text-neutral-500">{t("tts.settingsDesc")}</p>

        <div className="space-y-5">
          {/* Engine selection — 3 engines */}
          <div className="space-y-2">
            <span className="text-sm text-neutral-800">{t("tts.engine")}</span>
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
              <span className="text-sm text-neutral-800">{t("tts.rate")}</span>
              <span className="rounded bg-background px-2 py-0.5 text-xs font-medium text-neutral-600">
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

          {/* Pitch (browser only) */}
          {config.engine === "browser" && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm text-neutral-800">{t("tts.pitch")}</span>
                <span className="rounded bg-background px-2 py-0.5 text-xs font-medium text-neutral-600">
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
              <span className="text-sm text-neutral-800">{t("tts.voice")}</span>
              <Select
                value={config.edgeVoice}
                onValueChange={(v) => updateConfig({ edgeVoice: v })}
              >
                <SelectTrigger className="w-[240px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {Array.from(edgeVoicesByLang.entries()).map(([lang, langVoices]) => (
                    <div key={lang}>
                      <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                        {lang}
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

          {config.engine === "browser" && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-800">{t("tts.voice")}</span>
              <Select
                value={config.voiceName || "__default__"}
                onValueChange={(v) => updateConfig({ voiceName: v === "__default__" ? "" : v })}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder={t("tts.defaultVoice")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">{t("tts.defaultVoice")}</SelectItem>
                  {voices.map((v) => (
                    <SelectItem key={v.name} value={v.name}>
                      {v.name} ({v.lang})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {config.engine === "dashscope" && (
            <>
              {/* DashScope voice */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-neutral-800">{t("tts.voice")}</span>
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
                <span className="text-sm text-neutral-800">{t("tts.apiKey")}</span>
                <Input
                  type="password"
                  placeholder={t("tts.apiKeyPlaceholder")}
                  value={config.dashscopeApiKey}
                  onChange={(e) => updateConfig({ dashscopeApiKey: e.target.value })}
                />
                <p className="text-xs text-neutral-500">
                  {t("tts.apiKeyHint")}{" "}
                  <a
                    href="https://bailian.console.aliyun.com/cn-beijing/?tab=model#/api-key"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline hover:text-primary/80"
                  >
                    {t("tts.getApiKey", "获取 API Key")}
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
