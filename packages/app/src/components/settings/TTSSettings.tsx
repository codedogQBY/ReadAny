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
  DASHSCOPE_VOICES,
  EDGE_TTS_VOICES,
  XIAOMI_TTS_VOICES,
  getSystemVoices,
} from "@/lib/tts/tts-service";
import {
  DEFAULT_SYSTEM_VOICE_VALUE,
  findSystemVoiceLabel,
  getSystemVoiceOptions,
  groupSystemVoiceOptions,
  resolveSystemVoiceValue,
} from "@/lib/tts/system-voices";
import { previewTTSConfig, stopTTSPreview } from "@/lib/tts/tts-preview";
import { useTTSStore } from "@/stores/tts-store";
import {
  DEFAULT_VOXCPM_BASE_URL,
  DEFAULT_VOXCPM_MODEL,
  DEFAULT_VOXCPM_VOICE,
  DEFAULT_XIAOMI_STYLE_PROMPT,
  getActiveTTSProfile,
  getLocaleDisplayLabel,
  getTTSProviderDefinition,
  groupEdgeTTSVoices,
  type TTSProviderType,
  type TTSProfile,
} from "@readany/core/tts";
import { Cloud, Headphones, Mic, Play, Settings2, Sparkles, Square, Zap } from "lucide-react";
import type { TFunction } from "i18next";
/**
 * TTSSettings — TTS configuration panel in the settings dialog.
 *
 * Uses shadcn/ui components: Select, Slider, Button.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const PREVIEW_FALLBACK_TIMEOUT_MS = 8000;

function providerLabel(provider: TTSProviderType, t: TFunction) {
  return t(`tts.provider.${provider}.label`, { defaultValue: provider });
}

function providerDescription(provider: TTSProviderType, t: TFunction) {
  return t(`tts.provider.${provider}.description`, { defaultValue: "" });
}

function providerCategory(category: string, t: TFunction) {
  return t(`tts.providerCategory.${category}`, { defaultValue: category });
}

function profileName(profile: TTSProfile, t: TFunction) {
  return profile.id.endsWith("-default")
    ? providerLabel(profile.provider, t)
    : profile.name || providerLabel(profile.provider, t);
}

export function TTSSettings() {
  const { t, i18n } = useTranslation();
  const config = useTTSStore((s) => s.config);
  const updateConfig = useTTSStore((s) => s.updateConfig);
  const stop = useTTSStore((s) => s.stop);

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const previewRunRef = useRef(0);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPreviewTimer = useCallback(() => {
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
  }, []);

  const endPreviewFeedback = useCallback(
    (run: number) => {
      if (previewRunRef.current !== run) return;
      clearPreviewTimer();
      setIsPreviewing(false);
    },
    [clearPreviewTimer],
  );

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

  useEffect(
    () => () => {
      previewRunRef.current += 1;
      clearPreviewTimer();
      stopTTSPreview();
    },
    [clearPreviewTimer],
  );

  const handlePreview = async () => {
    if (isPreviewing) {
      previewRunRef.current += 1;
      clearPreviewTimer();
      stopTTSPreview();
      setIsPreviewing(false);
      return;
    }

    const run = previewRunRef.current + 1;
    previewRunRef.current = run;
    setIsPreviewing(true);
    stop();
    previewTimerRef.current = setTimeout(
      () => endPreviewFeedback(run),
      PREVIEW_FALLBACK_TIMEOUT_MS,
    );
    await previewTTSConfig(t("tts.testText", "这是一段测试文本"), config, {
      onStateChange: (state) => {
        if (state === "stopped") endPreviewFeedback(run);
      },
      onEnd: () => endPreviewFeedback(run),
    });
  };

  const profiles = config.profiles;
  const activeProfile = getActiveTTSProfile(config);
  const defaultStylePrompt = t("tts.defaultStylePrompt", DEFAULT_XIAOMI_STYLE_PROMPT);
  const xiaomiStylePromptValue =
    config.xiaomiStylePrompt === DEFAULT_XIAOMI_STYLE_PROMPT
      ? defaultStylePrompt
      : config.xiaomiStylePrompt;
  const openAIStylePromptValue =
    config.openaiTtsStylePrompt === DEFAULT_XIAOMI_STYLE_PROMPT
      ? defaultStylePrompt
      : config.openaiTtsStylePrompt;
  const activeProvider = getTTSProviderDefinition(activeProfile.provider);
  const providerIcon = activeProfile.provider === "system"
    ? Headphones
    : activeProfile.provider === "edge"
      ? Zap
      : activeProfile.provider === "dashscope"
        ? Mic
        : activeProfile.provider === "xiaomi"
          ? Cloud
          : activeProfile.provider === "voxcpm"
            ? Sparkles
            : Settings2;
  const ProviderIcon = providerIcon;

  const selectProfile = (profileId: string) => {
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) return;
    updateConfig({ activeProfileId: profile.id, engine: profile.provider });
  };

  const updateActiveProfile = (updates: Partial<TTSProfile>) => {
    updateConfig({
      profiles: profiles.map((profile) =>
        profile.id === activeProfile.id ? { ...profile, ...updates } : profile,
      ),
    });
  };

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
            variant={isPreviewing ? "default" : "secondary"}
            size="sm"
            className="shrink-0 min-w-[92px]"
            onClick={handlePreview}
          >
            {isPreviewing ? (
              <Square className="mr-1.5 h-3.5 w-3.5 fill-current" />
            ) : (
              <Play className="mr-1.5 h-3.5 w-3.5" />
            )}
            {isPreviewing
              ? t("common.previewing", "试听中")
              : t("common.preview", "试听")}
          </Button>
        </div>

        <div className="space-y-5">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-foreground">{t("tts.voiceProfile", "朗读方案")}</span>
              <Select value={activeProfile.id} onValueChange={selectProfile}>
                <SelectTrigger className="w-[240px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((profile) => {
                    return (
                      <SelectItem key={profile.id} value={profile.id}>
                        {profileName(profile, t)}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-lg border border-border bg-background p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2">
                  <ProviderIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-foreground">
                      {profileName(activeProfile, t)}
                    </div>
                    <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                      {providerDescription(activeProfile.provider, t)}
                    </p>
                  </div>
                </div>
                <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {providerCategory(activeProvider.category, t)}
                </span>
              </div>
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
                onValueChange={(v) => {
                  updateActiveProfile({ voice: v });
                  updateConfig({ edgeVoice: v });
                }}
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
                    updateActiveProfile({ voice: "" });
                    return;
                  }
                  updateActiveProfile({ voice: v });
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
                  onValueChange={(v) => {
                    updateActiveProfile({ voice: v });
                    updateConfig({ dashscopeVoice: v });
                  }}
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
                  onChange={(e) => {
                    updateActiveProfile({ apiKey: e.target.value });
                    updateConfig({ dashscopeApiKey: e.target.value });
                  }}
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

          {config.engine === "xiaomi" && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground">{t("tts.voice")}</span>
                <Select
                  value={config.xiaomiVoice}
                  onValueChange={(v) => {
                    updateActiveProfile({ voice: v });
                    updateConfig({ xiaomiVoice: v });
                  }}
                >
                  <SelectTrigger className="w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {XIAOMI_TTS_VOICES.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <span className="text-sm text-foreground">{t("tts.apiKey", "API Key")}</span>
                <PasswordInput
                  placeholder="MIMO_API_KEY"
                  value={config.xiaomiApiKey}
                  onChange={(e) => {
                    updateActiveProfile({ apiKey: e.target.value });
                    updateConfig({ xiaomiApiKey: e.target.value });
                  }}
                />
              </div>
              <div className="space-y-2">
                <span className="text-sm text-foreground">{t("tts.baseUrl", "Base URL")}</span>
                <input
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={config.xiaomiBaseUrl}
                  onChange={(e) => {
                    updateActiveProfile({ baseUrl: e.target.value });
                    updateConfig({ xiaomiBaseUrl: e.target.value });
                  }}
                  placeholder="https://api.xiaomimimo.com/v1"
                />
              </div>
              <div className="space-y-2">
                <span className="text-sm text-foreground">{t("tts.stylePrompt", "朗读风格")}</span>
                <textarea
                  className="min-h-[74px] w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={xiaomiStylePromptValue}
                  onChange={(e) => {
                    updateActiveProfile({ stylePrompt: e.target.value });
                    updateConfig({ xiaomiStylePrompt: e.target.value });
                  }}
                  placeholder={defaultStylePrompt}
                />
              </div>
            </>
          )}

          {config.engine === "openai-compatible" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <span className="text-sm text-foreground">{t("tts.baseUrl", "Base URL")}</span>
                  <input
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={config.openaiTtsBaseUrl}
                    onChange={(e) => {
                      updateActiveProfile({ baseUrl: e.target.value });
                      updateConfig({ openaiTtsBaseUrl: e.target.value });
                    }}
                    placeholder="https://api.openai.com/v1"
                  />
                </div>
                <div className="space-y-2">
                  <span className="text-sm text-foreground">{t("tts.endpoint", "Endpoint")}</span>
                  <Select
                    value={config.openaiTtsEndpoint}
                    onValueChange={(v) => {
                      const endpoint = v as "audio-speech" | "chat-completions";
                      updateActiveProfile({ endpoint });
                      updateConfig({ openaiTtsEndpoint: endpoint });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="audio-speech">/audio/speech</SelectItem>
                      <SelectItem value="chat-completions">/chat/completions</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <span className="text-sm text-foreground">{t("tts.model", "Model")}</span>
                  <input
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={config.openaiTtsModel}
                    onChange={(e) => {
                      updateActiveProfile({ model: e.target.value });
                      updateConfig({ openaiTtsModel: e.target.value });
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <span className="text-sm text-foreground">{t("tts.voice")}</span>
                  <input
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={config.openaiTtsVoice}
                    onChange={(e) => {
                      updateActiveProfile({ voice: e.target.value });
                      updateConfig({ openaiTtsVoice: e.target.value });
                    }}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground">{t("tts.format", "Format")}</span>
                <Select
                  value={config.openaiTtsFormat}
                  onValueChange={(v) => {
                    const format = v as "mp3" | "wav" | "pcm16";
                    updateActiveProfile({ format });
                    updateConfig({ openaiTtsFormat: format });
                  }}
                >
                  <SelectTrigger className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mp3">mp3</SelectItem>
                    <SelectItem value="wav">wav</SelectItem>
                    <SelectItem value="pcm16">pcm16</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <span className="text-sm text-foreground">{t("tts.apiKey", "API Key")}</span>
                <PasswordInput
                  placeholder="sk-..."
                  value={config.openaiTtsApiKey}
                  onChange={(e) => {
                    updateActiveProfile({ apiKey: e.target.value });
                    updateConfig({ openaiTtsApiKey: e.target.value });
                  }}
                />
              </div>
              {config.openaiTtsEndpoint === "chat-completions" && (
                <div className="space-y-2">
                  <span className="text-sm text-foreground">{t("tts.stylePrompt", "朗读风格")}</span>
                  <textarea
                    className="min-h-[74px] w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={openAIStylePromptValue}
                    onChange={(e) => {
                      updateActiveProfile({ stylePrompt: e.target.value });
                      updateConfig({ openaiTtsStylePrompt: e.target.value });
                    }}
                    placeholder={defaultStylePrompt}
                  />
                </div>
              )}
            </>
          )}

          {config.engine === "voxcpm" && (
            <>
              <div className="space-y-2">
                <span className="text-sm text-foreground">{t("tts.baseUrl", "Base URL")}</span>
                <input
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={config.voxcpmBaseUrl}
                  onChange={(e) => {
                    updateActiveProfile({ baseUrl: e.target.value });
                    updateConfig({ voxcpmBaseUrl: e.target.value });
                  }}
                  placeholder={DEFAULT_VOXCPM_BASE_URL}
                />
                <p className="text-xs text-muted-foreground">
                  {t("tts.voxcpmBaseUrlHint", "")}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <span className="text-sm text-foreground">{t("tts.model", "Model")}</span>
                  <input
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={config.voxcpmModel}
                    onChange={(e) => {
                      updateActiveProfile({ model: e.target.value });
                      updateConfig({ voxcpmModel: e.target.value });
                    }}
                    placeholder={DEFAULT_VOXCPM_MODEL}
                  />
                </div>
                <div className="space-y-2">
                  <span className="text-sm text-foreground">{t("tts.voice")}</span>
                  <input
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={config.voxcpmVoice}
                    onChange={(e) => {
                      updateActiveProfile({ voice: e.target.value });
                      updateConfig({ voxcpmVoice: e.target.value });
                    }}
                    placeholder={DEFAULT_VOXCPM_VOICE}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <span className="text-sm text-foreground">
                  {t("tts.voiceDesign", "Voice design")}
                </span>
                <textarea
                  className="min-h-[74px] w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={config.voxcpmVoiceDesign}
                  onChange={(e) => {
                    updateActiveProfile({ stylePrompt: e.target.value });
                    updateConfig({ voxcpmVoiceDesign: e.target.value });
                  }}
                  placeholder={t("tts.voiceDesignPlaceholder", "")}
                />
                <p className="text-xs text-muted-foreground">
                  {t("tts.voiceDesignHint", "")}
                </p>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground">{t("tts.format", "Format")}</span>
                <Select
                  value={config.voxcpmFormat}
                  onValueChange={(v) => {
                    const format = v as "mp3" | "wav";
                    updateActiveProfile({ format });
                    updateConfig({ voxcpmFormat: format });
                  }}
                >
                  <SelectTrigger className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="wav">wav</SelectItem>
                    <SelectItem value="mp3">mp3</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <span className="text-sm text-foreground">
                  {t("tts.apiKeyOptional", "API Key (optional)")}
                </span>
                <PasswordInput
                  placeholder=""
                  value={config.voxcpmApiKey}
                  onChange={(e) => {
                    updateActiveProfile({ apiKey: e.target.value });
                    updateConfig({ voxcpmApiKey: e.target.value });
                  }}
                />
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
