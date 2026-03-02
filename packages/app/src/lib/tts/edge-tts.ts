/**
 * Edge TTS — Free high-quality Microsoft Neural TTS via Edge browser's read-aloud WebSocket API.
 *
 * Uses @tauri-apps/plugin-websocket to set custom headers (User-Agent, Origin, Cookie)
 * that browser native WebSocket cannot set — required by the Edge TTS server.
 *
 * Audio format: audio-24khz-48kbitrate-mono-mp3 (MP3, 24kHz, 48kbps, mono).
 */

// ── Constants ──
const EDGE_SPEECH_URL =
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const EDGE_API_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const CHROMIUM_MAJOR_VERSION = "143";

const WIN_EPOCH_OFFSET = 11644473600n; // BigInt
const S_TO_NS = 1000000000n; // BigInt

// ── Voice list ──
const EDGE_TTS_VOICE_MAP: Record<string, string[]> = {
  "af-ZA": ["af-ZA-AdriNeural", "af-ZA-WillemNeural"],
  "ar-SA": ["ar-SA-HamedNeural", "ar-SA-ZariyahNeural"],
  "bg-BG": ["bg-BG-BorislavNeural", "bg-BG-KalinaNeural"],
  "ca-ES": ["ca-ES-EnricNeural", "ca-ES-JoanaNeural"],
  "cs-CZ": ["cs-CZ-AntoninNeural", "cs-CZ-VlastaNeural"],
  "da-DK": ["da-DK-ChristelNeural", "da-DK-JeppeNeural"],
  "de-DE": [
    "de-DE-AmalaNeural",
    "de-DE-ConradNeural",
    "de-DE-FlorianMultilingualNeural",
    "de-DE-KatjaNeural",
    "de-DE-KillianNeural",
    "de-DE-SeraphinaMultilingualNeural",
  ],
  "el-GR": ["el-GR-AthinaNeural", "el-GR-NestorasNeural"],
  "en-AU": ["en-AU-NatashaNeural", "en-AU-WilliamNeural"],
  "en-CA": ["en-CA-ClaraNeural", "en-CA-LiamNeural"],
  "en-GB": [
    "en-GB-LibbyNeural",
    "en-GB-MaisieNeural",
    "en-GB-RyanNeural",
    "en-GB-SoniaNeural",
    "en-GB-ThomasNeural",
  ],
  "en-IN": ["en-IN-NeerjaExpressiveNeural", "en-IN-NeerjaNeural", "en-IN-PrabhatNeural"],
  "en-US": [
    "en-US-AriaNeural",
    "en-US-AndrewMultilingualNeural",
    "en-US-AndrewNeural",
    "en-US-AvaMultilingualNeural",
    "en-US-AvaNeural",
    "en-US-BrianMultilingualNeural",
    "en-US-BrianNeural",
    "en-US-ChristopherNeural",
    "en-US-EmmaMultilingualNeural",
    "en-US-EmmaNeural",
    "en-US-EricNeural",
    "en-US-GuyNeural",
    "en-US-JennyNeural",
    "en-US-MichelleNeural",
    "en-US-RogerNeural",
    "en-US-SteffanNeural",
  ],
  "es-ES": ["es-ES-AlvaroNeural", "es-ES-ElviraNeural", "es-ES-XimenaNeural"],
  "es-MX": ["es-MX-DaliaNeural", "es-MX-JorgeNeural"],
  "fi-FI": ["fi-FI-HarriNeural", "fi-FI-NooraNeural"],
  "fr-CA": ["fr-CA-AntoineNeural", "fr-CA-JeanNeural", "fr-CA-SylvieNeural"],
  "fr-FR": [
    "fr-FR-DeniseNeural",
    "fr-FR-EloiseNeural",
    "fr-FR-HenriNeural",
    "fr-FR-RemyMultilingualNeural",
    "fr-FR-VivienneMultilingualNeural",
  ],
  "he-IL": ["he-IL-AvriNeural", "he-IL-HilaNeural"],
  "hi-IN": ["hi-IN-MadhurNeural", "hi-IN-SwaraNeural"],
  "hr-HR": ["hr-HR-GabrijelaNeural", "hr-HR-SreckoNeural"],
  "hu-HU": ["hu-HU-NoemiNeural", "hu-HU-TamasNeural"],
  "id-ID": ["id-ID-ArdiNeural", "id-ID-GadisNeural"],
  "it-IT": [
    "it-IT-DiegoNeural",
    "it-IT-ElsaNeural",
    "it-IT-GiuseppeMultilingualNeural",
    "it-IT-IsabellaNeural",
  ],
  "ja-JP": ["ja-JP-KeitaNeural", "ja-JP-NanamiNeural"],
  "ko-KR": ["ko-KR-HyunsuMultilingualNeural", "ko-KR-InJoonNeural", "ko-KR-SunHiNeural"],
  "ms-MY": ["ms-MY-OsmanNeural", "ms-MY-YasminNeural"],
  "nb-NO": ["nb-NO-FinnNeural", "nb-NO-PernilleNeural"],
  "nl-NL": ["nl-NL-ColetteNeural", "nl-NL-FennaNeural", "nl-NL-MaartenNeural"],
  "pl-PL": ["pl-PL-MarekNeural", "pl-PL-ZofiaNeural"],
  "pt-BR": ["pt-BR-AntonioNeural", "pt-BR-FranciscaNeural", "pt-BR-ThalitaMultilingualNeural"],
  "pt-PT": ["pt-PT-DuarteNeural", "pt-PT-RaquelNeural"],
  "ro-RO": ["ro-RO-AlinaNeural", "ro-RO-EmilNeural"],
  "ru-RU": ["ru-RU-DmitryNeural", "ru-RU-SvetlanaNeural"],
  "sk-SK": ["sk-SK-LukasNeural", "sk-SK-ViktoriaNeural"],
  "sv-SE": ["sv-SE-MattiasNeural", "sv-SE-SofieNeural"],
  "th-TH": ["th-TH-NiwatNeural", "th-TH-PremwadeeNeural"],
  "tr-TR": ["tr-TR-AhmetNeural", "tr-TR-EmelNeural"],
  "uk-UA": ["uk-UA-OstapNeural", "uk-UA-PolinaNeural"],
  "vi-VN": ["vi-VN-HoaiMyNeural", "vi-VN-NamMinhNeural"],
  "zh-CN": [
    "zh-CN-XiaoxiaoNeural",
    "zh-CN-XiaoyiNeural",
    "zh-CN-YunjianNeural",
    "zh-CN-YunxiNeural",
    "zh-CN-YunxiaNeural",
    "zh-CN-YunyangNeural",
    "zh-CN-liaoning-XiaobeiNeural",
    "zh-CN-shaanxi-XiaoniNeural",
  ],
  "zh-HK": ["zh-HK-HiuGaaiNeural", "zh-HK-HiuMaanNeural", "zh-HK-WanLungNeural"],
  "zh-TW": ["zh-TW-HsiaoChenNeural", "zh-TW-HsiaoYuNeural", "zh-TW-YunJheNeural"],
};

export interface EdgeTTSVoice {
  id: string;
  name: string;
  lang: string;
}

function buildVoiceList(): EdgeTTSVoice[] {
  return Object.entries(EDGE_TTS_VOICE_MAP).flatMap(([lang, voices]) =>
    voices.map((id) => ({
      id,
      name: id.replace(`${lang}-`, "").replace("Neural", ""),
      lang,
    })),
  );
}

export const EDGE_TTS_VOICES: EdgeTTSVoice[] = buildVoiceList();

// ── Sec-MS-GEC Token Generation (BigInt for precision) ──

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

async function generateSecMsGec(): Promise<string> {
  // Use BigInt for full precision (ticks exceed Number.MAX_SAFE_INTEGER)
  let ticks = BigInt(Math.floor(Date.now() / 1000));
  ticks += WIN_EPOCH_OFFSET;
  ticks -= ticks % 300n;
  ticks *= S_TO_NS / 100n; // Convert to 100-nanosecond intervals (Windows file time)
  const strToHash = `${ticks.toString()}${EDGE_API_TOKEN}`;
  return sha256Hex(strToHash);
}

function generateMuid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function randomHex(len: number): string {
  const array = new Uint8Array(len);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── SSML Generation ──

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function genSSML(lang: string, text: string, voice: string, rate: number, pitch: number): string {
  const rateStr = `${rate >= 1 ? "+" : ""}${Math.round((rate - 1) * 100)}%`;
  const pitchStr = `${pitch >= 1 ? "+" : ""}${Math.round((pitch - 1) * 50)}Hz`;
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}">` +
    `<voice name="${voice}">` +
    `<prosody rate="${rateStr}" pitch="${pitchStr}">` +
    escapeXml(text) +
    `</prosody></voice></speak>`
  );
}

// ── Message formatter ──

function genMessage(headers: Record<string, string>, content: string): string {
  let header = "";
  for (const key of Object.keys(headers)) {
    header += `${key}: ${headers[key]}\r\n`;
  }
  return `${header}\r\n${content}`;
}

// ── Edge TTS WebSocket Client (using Tauri WebSocket plugin) ──

export interface EdgeTTSPayload {
  text: string;
  voice: string;
  lang: string;
  rate: number;
  pitch: number;
}

/**
 * Fetch audio from Edge TTS via Tauri WebSocket plugin.
 * The Tauri plugin allows setting custom headers (User-Agent, Origin, Cookie)
 * that browser native WebSocket cannot set.
 * Returns the accumulated MP3 audio as an ArrayBuffer.
 */
export async function fetchEdgeTTSAudio(payload: EdgeTTSPayload): Promise<ArrayBuffer> {
  const TauriWebSocket = (await import("@tauri-apps/plugin-websocket")).default;

  const connectId = randomHex(16);
  const secMsGec = await generateSecMsGec();

  const params = new URLSearchParams({
    ConnectionId: connectId,
    TrustedClientToken: EDGE_API_TOKEN,
    "Sec-MS-GEC": secMsGec,
    "Sec-MS-GEC-Version": `1-${CHROMIUM_FULL_VERSION}`,
  });
  const url = `${EDGE_SPEECH_URL}?${params.toString()}`;

  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" +
      ` (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36` +
      ` Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "en-US,en;q=0.9",
    Pragma: "no-cache",
    "Cache-Control": "no-cache",
    Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
    Cookie: `muid=${generateMuid()};`,
  };

  const date = new Date().toString();
  const ssml = genSSML(payload.lang, payload.text, payload.voice, payload.rate, payload.pitch);

  const configMsg = genMessage(
    {
      "Content-Type": "application/json; charset=utf-8",
      Path: "speech.config",
      "X-Timestamp": date,
    },
    JSON.stringify({
      context: {
        synthesis: {
          audio: {
            metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: true },
            outputFormat: "audio-24khz-48kbitrate-mono-mp3",
          },
        },
      },
    }),
  );

  const ssmlMsg = genMessage(
    {
      "Content-Type": "application/ssml+xml",
      Path: "ssml",
      "X-RequestId": connectId,
      "X-Timestamp": date,
    },
    ssml,
  );

  return new Promise(async (resolve, reject) => {
    try {
      const ws = await TauriWebSocket.connect(url, { headers });
      let audioData = new ArrayBuffer(0);

      const messageUnlisten = await ws.addListener((msg) => {
        try {
          if (msg.type === "Text") {
            const text = msg.data as string;
            if (text.includes("Path:turn.end") || text.includes("Path: turn.end")) {
              ws.disconnect();
              messageUnlisten();
              if (!audioData.byteLength) {
                return reject(new Error("No audio data received from Edge TTS."));
              }
              return resolve(audioData);
            }
          } else if (msg.type === "Binary") {
            const bytes = new Uint8Array(msg.data as number[]);
            if (bytes.length < 2) return;
            const headerLength = (bytes[0] << 8) | bytes[1];
            if (bytes.length > headerLength + 2) {
              const newBody = bytes.slice(2 + headerLength);
              const merged = new Uint8Array(audioData.byteLength + newBody.byteLength);
              merged.set(new Uint8Array(audioData), 0);
              merged.set(newBody, audioData.byteLength);
              audioData = merged.buffer;
            }
          }
        } catch (err) {
          console.error("[Edge TTS] message handling error:", err);
        }
      });

      await ws.send(configMsg);
      await ws.send(ssmlMsg);
    } catch (error) {
      reject(new Error(`Edge TTS WebSocket error: ${error}`));
    }
  });
}
