/**
 * Client-side Web Audio compilation and encoding helper.
 */

/**
 * Encodes an AudioBuffer into a standard indexable 16-bit PCM WAV Blob.
 */
export function bufferToWav(buffer: AudioBuffer): Blob {
  const numOfChan = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // Raw LPCM
  const bitDepth = 16;
  
  let result: Float32Array;
  if (numOfChan === 2) {
    // Interleave left and right channels for stereo
    result = interleave(buffer.getChannelData(0), buffer.getChannelData(1));
  } else {
    // Mono
    result = buffer.getChannelData(0);
  }
  
  const bufferLength = result.length * 2; // 16-bit samples take 2 bytes each
  const headerBuffer = new ArrayBuffer(44);
  const view = new DataView(headerBuffer);
  
  // RIFF Chunk Descriptor
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + bufferLength, true); // size of entire file after this field
  writeString(view, 8, "WAVE");
  
  // fmt sub-chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // subchunk1 size
  view.setUint16(20, format, true); // audio format (1 for PCM)
  view.setUint16(22, numOfChan, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numOfChan * 2, true); // byteRate
  view.setUint16(32, numOfChan * 2, true); // blockAlign
  view.setUint16(34, bitDepth, true); // bitsPerSample
  
  // data sub-chunk
  writeString(view, 36, "data");
  view.setUint32(40, bufferLength, true); // data size
  
  // Create final ArrayBuffer for compilation
  const finalBuffer = new ArrayBuffer(44 + bufferLength);
  const finalView = new DataView(finalBuffer);
  
  // Write WAV header
  for (let i = 0; i < 44; i++) {
    finalView.setUint8(i, view.getUint8(i));
  }
  
  // Convert Float32 samples from Web Audio to signed 16-bit PCM integers
  let offset = 44;
  for (let i = 0; i < result.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, result[i]));
    finalView.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  
  return new Blob([finalBuffer], { type: "audio/wav" });
}

function interleave(inputL: Float32Array, inputR: Float32Array): Float32Array {
  const length = inputL.length + inputR.length;
  const result = new Float32Array(length);
  let index = 0;
  let inputIndex = 0;
  while (index < length) {
    result[index++] = inputL[inputIndex];
    result[index++] = inputR[inputIndex];
    inputIndex++;
  }
  return result;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * Fetches an audio path from Express /api/tts endpoint and decodes it.
 * Falls back to public dictionary APIs if running on a static server (like GitHub Pages).
 */
export async function fetchAndDecodeTTS(
  word: string,
  gender: "male" | "female",
  audioContext: AudioContext
): Promise<AudioBuffer> {
  // If we are on static hosting, /api/tts might not exist, but let's try it first
  try {
    const url = `/api/tts?word=${encodeURIComponent(word)}&gender=${gender}`;
    const response = await fetch(url);
    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer();
      return await audioContext.decodeAudioData(arrayBuffer);
    }
  } catch (err) {
    console.warn(`Local API fetch failed, trying direct public API fallback for "${word}"...`, err);
  }

  // Attempt 2: Direct Youdao TTS (Type 1 is British English)
  try {
    const youdaoUrl = `https://dict.youdao.com/dictvoice?type=1&audio=${encodeURIComponent(word)}`;
    const response = await fetch(youdaoUrl);
    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer();
      return await audioContext.decodeAudioData(arrayBuffer);
    }
  } catch (err) {
    console.warn(`Youdao client-side fetch failed for "${word}" (probably CORS on static page).`, err);
  }

  // Final fallback: Create a silent buffer with standard word length (e.g., 1.2 seconds)
  // so that compilation can still successfully run and play, even if audio is missing!
  console.warn(`All TTS fetch attempts failed for "${word}". Creating silent buffer fallback...`);
  return audioContext.createBuffer(1, audioContext.sampleRate * 1.2, audioContext.sampleRate);
}

/**
 * Direct client-side speech synthesis utilizing browser Web Speech API.
 * Bypasses CORS and network requirements completely.
 */
export function speakWordClientSide(
  word: string,
  gender: "male" | "female" = "female"
): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      resolve();
      return;
    }
    // Cancel any ongoing speeches
    try {
      window.speechSynthesis.cancel();
    } catch (e) {}

    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = "en-GB"; // UK British English
    
    // Attempt to set a British voice
    const voices = window.speechSynthesis.getVoices();
    const gbVoice = voices.find(v => {
      const name = v.name.toLowerCase();
      const lang = v.lang.toLowerCase();
      const matchLang = lang.startsWith("en-gb");
      const matchGender = gender === "male" ? name.includes("male") : name.includes("female") || !name.includes("male");
      return matchLang && matchGender;
    }) || voices.find(v => v.lang.toLowerCase().startsWith("en-gb"))
       || voices.find(v => v.lang.toLowerCase().startsWith("en"));
       
    if (gbVoice) {
      utterance.voice = gbVoice;
    }
    
    utterance.rate = 0.95; // Standard rate
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();

    window.speechSynthesis.speak(utterance);
  });
}

/**
 * Creates a silent AudioBuffer of dedicated duration.
 */
export function createSilenceBuffer(
  durationSeconds: number,
  sampleRate: number,
  audioContext: AudioContext
): AudioBuffer {
  return audioContext.createBuffer(1, sampleRate * durationSeconds, sampleRate);
}
