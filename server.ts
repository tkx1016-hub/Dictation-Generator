import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Serve static assets from public/cache directories
const CACHE_DIR = path.join(process.cwd(), "cache");
const MALE_CACHE_DIR = path.join(CACHE_DIR, "male");
const FEMALE_CACHE_DIR = path.join(CACHE_DIR, "female");

// Ensure cache directories exist
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}
if (!fs.existsSync(MALE_CACHE_DIR)) {
  fs.mkdirSync(MALE_CACHE_DIR, { recursive: true });
}
if (!fs.existsSync(FEMALE_CACHE_DIR)) {
  fs.mkdirSync(FEMALE_CACHE_DIR, { recursive: true });
}

// Initialize Gemini Client
let ai: GoogleGenAI | null = null;
if (process.env.GEMINI_API_KEY) {
  ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

// Convert PCM buffer to standard 16-bit WAV
function pcmToWav(pcmBuffer: Buffer, sampleRate = 24000): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // Raw PCM
  header.writeUInt16LE(1, 22); // Mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // Byte rate (sampleRate * blockAlign)
  header.writeUInt16LE(2, 32); // Block align (channels * bytes/sample)
  header.writeUInt16LE(16, 34); // Bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcmBuffer.length, 40);
  return Buffer.concat([header, pcmBuffer]);
}

// API endpoint to retrieve word pronunciation of British English (Male or Female)
app.get("/api/tts", async (req, res) => {
  const wordParam = req.query.word;
  const gender = req.query.gender === "male" ? "male" : "female";

  if (!wordParam || typeof wordParam !== "string") {
    return res.status(400).json({ error: "Missing word parameter" });
  }

  const word = wordParam.trim();
  const safeFileName = encodeURIComponent(word.toLowerCase());
  
  const cachePathWav = path.join(CACHE_DIR, gender, `${safeFileName}.wav`);
  const cachePathMp3 = path.join(CACHE_DIR, gender, `${safeFileName}.mp3`);

  // 1. Check WAV cache
  if (fs.existsSync(cachePathWav)) {
    res.setHeader("Content-Type", "audio/wav");
    return fs.createReadStream(cachePathWav).pipe(res);
  }

  // 2. Check MP3 cache
  if (fs.existsSync(cachePathMp3)) {
    res.setHeader("Content-Type", "audio/mpeg");
    return fs.createReadStream(cachePathMp3).pipe(res);
  }

  try {
    if (gender === "male") {
      // 3. Male Speech Synthesis using Gemini (if available)
      if (ai) {
        try {
          const geminiResponse = await ai.models.generateContent({
            model: "gemini-3.1-flash-tts-preview",
            contents: [
              {
                parts: [
                  {
                    text: `Pronounce the English word or phrase '${word}' clearly, naturally, and slowly in a standard British male accent. Only speak the word itself, do not say anything else.`,
                  },
                ],
              },
            ],
            config: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: "Fenrir" }, // 'Fenrir' or 'Zephyr' or 'Charon'
                },
              },
            },
          });

          const base64Audio = geminiResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
          
          if (base64Audio) {
            const pcmBuffer = Buffer.from(base64Audio, "base64");
            // Convert Gemini raw PCM (24kHz) to standard WAV
            const wavBuffer = pcmToWav(pcmBuffer, 24000);
            fs.writeFileSync(cachePathWav, wavBuffer);
            res.setHeader("Content-Type", "audio/wav");
            return res.send(wavBuffer);
          }
        } catch (err) {
          console.error("Gemini TTS failed, falling back to public TTS:", err);
        }
      }

      // Fallback for Male if Gemini client isn't configured or is throttled:
      // Since public APIs are primarily female, we fallback to our high-quality UK Female voice
      console.log(`Falling back to UK Female voice for male request on word: ${word}`);
    }

    // 4. Female Speech Synthesis (Youdao API type=1 is UK English spelling)
    const youdaoUrl = `https://dict.youdao.com/dictvoice?type=1&audio=${encodeURIComponent(word)}`;
    try {
      const fetchResponse = await fetch(youdaoUrl);
      if (fetchResponse.ok) {
        const arrayBuffer = await fetchResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        // Save to cache as MP3
        fs.writeFileSync(cachePathMp3, buffer);
        res.setHeader("Content-Type", "audio/mpeg");
        return res.send(buffer);
      }
    } catch (err) {
      console.error("Youdao TTS failed, trying Google TTS:", err);
    }

    // 5. Alternate Google Translation TTS fallback (en-gb)
    const googleUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=en-gb&client=tw-ob&q=${encodeURIComponent(word)}`;
    const googleResponse = await fetch(googleUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    if (googleResponse.ok) {
      const arrayBuffer = await googleResponse.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      // Save to cache as MP3
      fs.writeFileSync(cachePathMp3, buffer);
      res.setHeader("Content-Type", "audio/mpeg");
      return res.send(buffer);
    }

    throw new Error("All TTS services failed to fetch pronunciation audio.");
  } catch (error: any) {
    console.error("Speech Synthesis Error:", error.message);
    res.status(500).json({ error: "Could not synthesize pronunciation audio." });
  }
});

// Setup Vite & Static Assets serving
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    
    app.use("*", async (req, res, next) => {
      const url = req.originalUrl;
      try {
        let template = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf-8");
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
