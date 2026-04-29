/**
 * Generates a silent WAV file in cache for keeping the iOS audio session alive.
 *
 * iOS suspends JS when no audio is playing. By inserting short silence tracks
 * into the TrackPlayer queue during starvation (all real chunks consumed but
 * more are still being fetched), we keep the audio session active and prevent
 * JS from being suspended in background.
 */
import { File, Paths } from "expo-file-system";

let _silenceUri: string | null = null;

/**
 * Returns the file URI of a ~1-second silent WAV.
 * Generated once in the cache directory and reused.
 */
export function ensureSilenceFile(): string {
  if (_silenceUri) {
    try {
      const f = new File(_silenceUri);
      if (f.exists) return _silenceUri;
    } catch {
      // file disappeared, regenerate
    }
  }

  const sampleRate = 22050;
  const numChannels = 1;
  const bitsPerSample = 16;
  const numSamples = sampleRate; // 1 second
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const headerSize = 44;
  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeStr(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(view, 8, "WAVE");

  // fmt sub-chunk
  writeStr(view, 12, "fmt ");
  view.setUint32(16, 16, true); // sub-chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
  view.setUint16(32, numChannels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);

  // data sub-chunk (samples are zero = silence)
  writeStr(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const file = new File(Paths.cache, "tts_silence_1s.wav");
  file.write(new Uint8Array(buffer));
  _silenceUri = file.uri;
  return _silenceUri;
}

function writeStr(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
