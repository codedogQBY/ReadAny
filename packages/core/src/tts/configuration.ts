import type { TTSConfig, TTSProfile } from "./types";

/** Maps legacy flat settings updates into the active provider profile. */
export function mergeTTSConfigUpdates(
  previousConfig: TTSConfig,
  updates: Partial<TTSConfig>,
): Partial<TTSConfig> {
  const provider = updates.engine ?? previousConfig.engine;
  const profileId = updates.activeProfileId ?? previousConfig.activeProfileId;
  const profileUpdates: Partial<TTSProfile> = {};

  if (provider === "edge" && updates.edgeVoice !== undefined) {
    profileUpdates.voice = updates.edgeVoice;
  } else if (provider === "system" && updates.voiceName !== undefined) {
    profileUpdates.voice = updates.voiceName;
  } else if (provider === "dashscope") {
    if (updates.dashscopeApiKey !== undefined) profileUpdates.apiKey = updates.dashscopeApiKey;
    if (updates.dashscopeVoice !== undefined) profileUpdates.voice = updates.dashscopeVoice;
  } else if (provider === "xiaomi") {
    if (updates.xiaomiBaseUrl !== undefined) profileUpdates.baseUrl = updates.xiaomiBaseUrl;
    if (updates.xiaomiApiKey !== undefined) profileUpdates.apiKey = updates.xiaomiApiKey;
    if (updates.xiaomiVoice !== undefined) profileUpdates.voice = updates.xiaomiVoice;
    if (updates.xiaomiStylePrompt !== undefined)
      profileUpdates.stylePrompt = updates.xiaomiStylePrompt;
  } else if (provider === "openai-compatible") {
    if (updates.openaiTtsBaseUrl !== undefined) profileUpdates.baseUrl = updates.openaiTtsBaseUrl;
    if (updates.openaiTtsApiKey !== undefined) profileUpdates.apiKey = updates.openaiTtsApiKey;
    if (updates.openaiTtsEndpoint !== undefined)
      profileUpdates.endpoint = updates.openaiTtsEndpoint;
    if (updates.openaiTtsModel !== undefined) profileUpdates.model = updates.openaiTtsModel;
    if (updates.openaiTtsVoice !== undefined) profileUpdates.voice = updates.openaiTtsVoice;
    if (updates.openaiTtsFormat !== undefined) profileUpdates.format = updates.openaiTtsFormat;
    if (updates.openaiTtsStylePrompt !== undefined)
      profileUpdates.stylePrompt = updates.openaiTtsStylePrompt;
  }

  if (!Object.keys(profileUpdates).length) return updates;
  const profiles = updates.profiles ?? previousConfig.profiles;
  const requested = profiles.find((profile) => profile.id === profileId);
  const targetId =
    requested?.provider === provider
      ? requested.id
      : profiles.find((profile) => profile.provider === provider)?.id;
  if (!targetId) return updates;

  return {
    ...updates,
    profiles: profiles.map((profile) =>
      profile.id === targetId ? { ...profile, ...profileUpdates } : profile,
    ),
  };
}
