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
 */
export async function fetchAndDecodeTTS(
  word: string,
  gender: "male" | "female",
  audioContext: AudioContext
): Promise<AudioBuffer> {
  const url = `/api/tts?word=${encodeURIComponent(word)}&gender=${gender}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch pronunciation for: "${word}"`);
  }
  const arrayBuffer = await response.arrayBuffer();
  // Safe decode (compatible with standard and old browsers)
  return await audioContext.decodeAudioData(arrayBuffer);
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
