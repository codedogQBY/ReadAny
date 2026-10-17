import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// --- English ---
import en_common from "./locales/en/common.json";
import en_library from "./locales/en/library.json";
import en_reader from "./locales/en/reader.json";
import en_chat from "./locales/en/chat.json";
import en_notes from "./locales/en/notes.json";
import en_settings from "./locales/en/settings.json";
import en_translation from "./locales/en/translation.json";
import en_tts from "./locales/en/tts.json";
import en_stats from "./locales/en/stats.json";
import en_onboarding from "./locales/en/onboarding.json";
import en_profile from "./locales/en/profile.json";
import en_misc from "./locales/en/misc.json";

// --- Simplified Chinese ---
import zh_common from "./locales/zh/common.json";
import zh_library from "./locales/zh/library.json";
import zh_reader from "./locales/zh/reader.json";
import zh_chat from "./locales/zh/chat.json";
import zh_notes from "./locales/zh/notes.json";
import zh_settings from "./locales/zh/settings.json";
import zh_translation from "./locales/zh/translation.json";
import zh_tts from "./locales/zh/tts.json";
import zh_stats from "./locales/zh/stats.json";
import zh_onboarding from "./locales/zh/onboarding.json";
import zh_profile from "./locales/zh/profile.json";
import zh_misc from "./locales/zh/misc.json";

// --- Traditional Chinese ---
import zhTW_common from "./locales/zh-TW/common.json";
import zhTW_library from "./locales/zh-TW/library.json";
import zhTW_reader from "./locales/zh-TW/reader.json";
import zhTW_chat from "./locales/zh-TW/chat.json";
import zhTW_notes from "./locales/zh-TW/notes.json";
import zhTW_settings from "./locales/zh-TW/settings.json";
import zhTW_translation from "./locales/zh-TW/translation.json";
import zhTW_tts from "./locales/zh-TW/tts.json";
import zhTW_stats from "./locales/zh-TW/stats.json";
import zhTW_onboarding from "./locales/zh-TW/onboarding.json";
import zhTW_profile from "./locales/zh-TW/profile.json";
import zhTW_misc from "./locales/zh-TW/misc.json";

// --- Japanese ---
import ja_common from "./locales/ja/common.json";
import ja_library from "./locales/ja/library.json";
import ja_reader from "./locales/ja/reader.json";
import ja_chat from "./locales/ja/chat.json";
import ja_notes from "./locales/ja/notes.json";
import ja_settings from "./locales/ja/settings.json";
import ja_translation from "./locales/ja/translation.json";
import ja_tts from "./locales/ja/tts.json";
import ja_stats from "./locales/ja/stats.json";
import ja_onboarding from "./locales/ja/onboarding.json";
import ja_profile from "./locales/ja/profile.json";
import ja_misc from "./locales/ja/misc.json";

// --- Korean ---
import ko_common from "./locales/ko/common.json";
import ko_library from "./locales/ko/library.json";
import ko_reader from "./locales/ko/reader.json";
import ko_chat from "./locales/ko/chat.json";
import ko_notes from "./locales/ko/notes.json";
import ko_settings from "./locales/ko/settings.json";
import ko_translation from "./locales/ko/translation.json";
import ko_tts from "./locales/ko/tts.json";
import ko_stats from "./locales/ko/stats.json";
import ko_onboarding from "./locales/ko/onboarding.json";
import ko_profile from "./locales/ko/profile.json";
import ko_misc from "./locales/ko/misc.json";

// --- French ---
import fr_common from "./locales/fr/common.json";
import fr_library from "./locales/fr/library.json";
import fr_reader from "./locales/fr/reader.json";
import fr_chat from "./locales/fr/chat.json";
import fr_notes from "./locales/fr/notes.json";
import fr_settings from "./locales/fr/settings.json";
import fr_translation from "./locales/fr/translation.json";
import fr_tts from "./locales/fr/tts.json";
import fr_stats from "./locales/fr/stats.json";
import fr_onboarding from "./locales/fr/onboarding.json";
import fr_profile from "./locales/fr/profile.json";
import fr_misc from "./locales/fr/misc.json";

// --- Spanish ---
import es_common from "./locales/es/common.json";
import es_library from "./locales/es/library.json";
import es_reader from "./locales/es/reader.json";
import es_chat from "./locales/es/chat.json";
import es_notes from "./locales/es/notes.json";
import es_settings from "./locales/es/settings.json";
import es_translation from "./locales/es/translation.json";
import es_tts from "./locales/es/tts.json";
import es_stats from "./locales/es/stats.json";
import es_onboarding from "./locales/es/onboarding.json";
import es_profile from "./locales/es/profile.json";
import es_misc from "./locales/es/misc.json";

// --- Merge modules per language ---
const en = {
  ...en_common,
  ...en_library,
  ...en_reader,
  ...en_chat,
  ...en_notes,
  ...en_settings,
  ...en_translation,
  ...en_tts,
  ...en_stats,
  ...en_onboarding,
  ...en_profile,
  ...en_misc,
};
const zh = {
  ...zh_common,
  ...zh_library,
  ...zh_reader,
  ...zh_chat,
  ...zh_notes,
  ...zh_settings,
  ...zh_translation,
  ...zh_tts,
  ...zh_stats,
  ...zh_onboarding,
  ...zh_profile,
  ...zh_misc,
};
const zhTW = {
  ...zhTW_common,
  ...zhTW_library,
  ...zhTW_reader,
  ...zhTW_chat,
  ...zhTW_notes,
  ...zhTW_settings,
  ...zhTW_translation,
  ...zhTW_tts,
  ...zhTW_stats,
  ...zhTW_onboarding,
  ...zhTW_profile,
  ...zhTW_misc,
};
const ja = {
  ...ja_common,
  ...ja_library,
  ...ja_reader,
  ...ja_chat,
  ...ja_notes,
  ...ja_settings,
  ...ja_translation,
  ...ja_tts,
  ...ja_stats,
  ...ja_onboarding,
  ...ja_profile,
  ...ja_misc,
};
const ko = {
  ...ko_common,
  ...ko_library,
  ...ko_reader,
  ...ko_chat,
  ...ko_notes,
  ...ko_settings,
  ...ko_translation,
  ...ko_tts,
  ...ko_stats,
  ...ko_onboarding,
  ...ko_profile,
  ...ko_misc,
};
const fr = {
  ...fr_common,
  ...fr_library,
  ...fr_reader,
  ...fr_chat,
  ...fr_notes,
  ...fr_settings,
  ...fr_translation,
  ...fr_tts,
  ...fr_stats,
  ...fr_onboarding,
  ...fr_profile,
  ...fr_misc,
};
const es = {
  ...es_common,
  ...es_library,
  ...es_reader,
  ...es_chat,
  ...es_notes,
  ...es_settings,
  ...es_translation,
  ...es_tts,
  ...es_stats,
  ...es_onboarding,
  ...es_profile,
  ...es_misc,
};

// Initialize with default "en". Each platform should call
// `initI18nLanguage()` after setPlatformService() to restore the saved lang.
export const i18nReady = i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
    "zh-TW": { translation: zhTW },
    ja: { translation: ja },
    ko: { translation: ko },
    fr: { translation: fr },
    es: { translation: es },
  },
  lng: "en",
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

/**
 * Restore saved language from platform KV storage.
 * Call this once at app startup AFTER `setPlatformService()`.
 */
export async function initI18nLanguage(): Promise<void> {
  try {
    const { getPlatformService } = await import("../services/platform");
    const platform = getPlatformService();

    // 1. Check if user has already chosen a language
    const savedLang =
      process.env.EXPO_PUBLIC_READANY_LANGUAGE ?? (await platform.kvGetItem("readany-lang"));

    if (savedLang && savedLang !== i18n.language) {
      try {
        await i18n.changeLanguage(savedLang);
      } catch {
        i18n.language = savedLang;
      }
      return;
    }

    // 2. If no saved language, try to get system locale as default
    if (!savedLang && platform.getLocale) {
      try {
        const systemLocale = await platform.getLocale();
        if (systemLocale) {
          const lc = systemLocale.toLowerCase();
          const lang =
            lc.startsWith("zh-tw") || lc.startsWith("zh-hk") || lc.startsWith("zh-hant")
              ? "zh-TW"
              : lc.startsWith("zh")
                ? "zh"
                : lc.startsWith("ja")
                  ? "ja"
                  : lc.startsWith("ko")
                    ? "ko"
                    : lc.startsWith("fr")
                      ? "fr"
                      : lc.startsWith("es")
                        ? "es"
                        : "en";
          if (lang !== i18n.language) {
            await i18n.changeLanguage(lang);
            await platform.kvSetItem("readany-lang", lang);
          }
        }
      } catch {
        // getLocale not supported or failed, keep default (en)
      }
    }
  } catch {
    // Platform not ready or storage error — keep default
  }
}

/**
 * Change language and persist the choice to platform KV storage.
 */
export async function changeAndPersistLanguage(lang: string): Promise<void> {
  try {
    await i18n.changeLanguage(lang);
  } catch {
    i18n.language = lang;
  }

  try {
    const { getPlatformService } = await import("../services/platform");
    const platform = getPlatformService();
    await platform.kvSetItem("readany-lang", lang);
  } catch {
    // Failed to persist — non-critical
  }
}

export default i18n;
