import { useState, useRef, useEffect } from "react";
import {
  AudioLines,
  Download,
  Play,
  Pause,
  RotateCcw,
  Volume2,
  FileText,
  Shuffle,
  Eye,
  EyeOff,
  Sparkles,
  HelpCircle,
  Repeat,
  History,
  Check,
  AlertCircle,
  Layers,
  ChevronRight,
  ListOrdered
} from "lucide-react";
import { PRESETS } from "./presets";
import { fetchAndDecodeTTS, bufferToWav } from "./utils/audio";
import { generateDictationPDF } from "./utils/pdf";

export default function App() {
  // Input section
  const [inputText, setInputText] = useState<string>(() => {
    // Default starting words to demonstrate the capability instantly
    return PRESETS[0].words.join("\n");
  });
  
  // Custom parsing & selection state
  const parsedWords = parseInput(inputText);
  const [dictationCount, setDictationCount] = useState<number>(10);
  const [voiceGender, setVoiceGender] = useState<"female" | "male">("female");
  const [repeatCount, setRepeatCount] = useState<0 | 1 | 2>(1); // default repeating 1 time (plays 2 times total)
  const [intervalSeconds, setIntervalSeconds] = useState<3 | 5 | 7>(5);
  const [order, setOrder] = useState<"random" | "sequential">("random");
  const [speechRate, setSpeechRate] = useState<0.8 | 1.0 | 1.2>(1.0);

  // Generated results
  const [selectedWords, setSelectedWords] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generationProgress, setGenerationProgress] = useState<string>("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);

  // Audio player state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [volume, setVolume] = useState<number>(1.0);

  // Results review panel
  const [isAnswersVisible, setIsAnswersVisible] = useState<boolean>(false);
  const [individualPlayingWord, setIndividualPlayingWord] = useState<string | null>(null);
  const [wordResults, setWordResults] = useState<Record<string, "correct" | "incorrect" | "unmarked">>({});

  // Error handling
  const [errorText, setErrorText] = useState<string>("");

  // Auto adjusting dictation quantity limit
  useEffect(() => {
    if (dictationCount > parsedWords.length && parsedWords.length > 0) {
      setDictationCount(parsedWords.length);
    }
  }, [parsedWords.length]);

  // Clean the helper string parser
  function parseInput(text: string): string[] {
    if (!text) return [];
    return text
      .split(/[\n,;，；\s]+/)
      .map(w => w.trim().replace(/[^a-zA-Z'\-]/g, "")) // preserve English alphabets, words like "don't", "long-term"
      .filter(w => w.length > 1); // remove single characters or empty lines
  }

  // Load Preset Vocabs
  const loadPreset = (words: string[]) => {
    setInputText(words.join("\n"));
    setDictationCount(Math.min(15, words.length));
    setErrorText("");
  };

  // Helper to shuffle array
  function shuffleArray<T>(array: T[]): T[] {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // CORE: Fetch individual files, merge and compile client-side Audio file
  const handleGenerateDictation = async () => {
    setErrorText("");
    if (parsedWords.length === 0) {
      setErrorText("请输入或选择一些英文单词后再试。");
      return;
    }

    setIsGenerating(true);
    setGenerationProgress("正在初始化音频解码引擎...");
    
    // Revoke previous URL to release browser memory
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
      setAudioBlob(null);
    }

    try {
      // 1. Pick and arrange the list of words
      let targetList = [...parsedWords];
      
      // Make unique first
      targetList = Array.from(new Set(targetList));
      
      if (order === "random") {
        targetList = shuffleArray(targetList);
      }
      
      // Slice up to selected word quantity
      const finalWords = targetList.slice(0, Math.min(dictationCount, targetList.length));
      setSelectedWords(finalWords);

      // Initialize grading stats
      const initialResults: Record<string, "unmarked"> = {};
      finalWords.forEach(w => {
        initialResults[w] = "unmarked";
      });
      setWordResults(initialResults);

      // 2. Fetch and Decode individual word audios
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const decodedBuffers: AudioBuffer[] = [];

      for (let i = 0; i < finalWords.length; i++) {
        const word = finalWords[i];
        setGenerationProgress(`正在生成英式单词读音 [${i + 1}/${finalWords.length}]: "${word}"...`);
        
        try {
          const buffer = await fetchAndDecodeTTS(word, voiceGender, audioCtx);
          decodedBuffers.push(buffer);
        } catch (fetchErr: any) {
          console.error(`Error loading TTS for word: ${word}`, fetchErr);
          // If a word pronunciation fetch fails, we continue with a generated short silence buffer 
          // so that the entire dictation sequence isn't corrupted by a single faulty dictionary word
          const fallbackSilence = audioCtx.createBuffer(1, audioCtx.sampleRate * 2, audioCtx.sampleRate);
          decodedBuffers.push(fallbackSilence);
        }
      }

      setGenerationProgress("正在进行高级声频数据混合编排...");

      // 3. Arrange timelines and Offline Audios
      // Total duration calculation:
      // Play counts: repeatCount + 1
      // Silence between repeating same words: 1.5 seconds gap
      // Silence between different words: intervalSeconds
      let totalSamples = 0;
      const sampleRate = audioCtx.sampleRate;

      for (let i = 0; i < decodedBuffers.length; i++) {
        const b = decodedBuffers[i];
        const singleRepSamples = Math.floor(b.length / speechRate);
        const repCount = repeatCount + 1; // total plays of this word
        
        // Total active voice samples
        totalSamples += singleRepSamples * repCount;
        
        // Pause between repetitions
        if (repeatCount > 0) {
          totalSamples += Math.floor(1.5 * sampleRate * repeatCount);
        }

        // Pause between word-to-word transition
        if (i < decodedBuffers.length - 1) {
          totalSamples += Math.floor(intervalSeconds * sampleRate);
        }
      }

      // Add small ending fade-out padding (1 sec)
      totalSamples += sampleRate;

      // Create offline audio context
      const offlineCtx = new OfflineAudioContext(1, totalSamples, sampleRate);
      let schedulePointer = 0; // tracking time in seconds

      for (let i = 0; i < decodedBuffers.length; i++) {
        const buffer = decodedBuffers[i];
        const dur = buffer.duration / speechRate;
        const totalReps = repeatCount + 1;

        for (let rep = 0; rep < totalReps; rep++) {
          const sourceNode = offlineCtx.createBufferSource();
          sourceNode.buffer = buffer;
          sourceNode.playbackRate.value = speechRate;
          sourceNode.connect(offlineCtx.destination);
          sourceNode.start(schedulePointer);

          schedulePointer += dur;

          // Pause between local word repeats
          if (rep < totalReps - 1) {
            schedulePointer += 1.5;
          }
        }

        // Wait before reading the next word
        if (i < decodedBuffers.length - 1) {
          schedulePointer += intervalSeconds;
        }
      }

      const renderedBuffer = await offlineCtx.startRendering();
      
      setGenerationProgress("正在打包生成 WAV 听写音频文件...");
      const finalBlob = bufferToWav(renderedBuffer);
      const url = URL.createObjectURL(finalBlob);

      setAudioBlob(finalBlob);
      setAudioUrl(url);
      setIsAnswersVisible(false); // Hide answers during a fresh generation cycle

      // Load into audio tag
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.load();
      }

    } catch (err: any) {
      console.error(err);
      setErrorText(`听写音频编译失败: ${err.message || "未知音频解码错误"}`);
    } finally {
      setIsGenerating(false);
      setGenerationProgress("");
    }
  };

  // Custom Audio Controller commands
  const togglePlayPause = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(e => console.error(e));
    }
  };

  const skipRelative = (sec: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(0, Math.min(duration, audioRef.current.currentTime + sec));
  };

  const handleSeek = (val: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = val;
    setCurrentTime(val);
  };

  const handleVolumeChange = (v: number) => {
    setVolume(v);
    if (audioRef.current) {
      audioRef.current.volume = v;
    }
  };

  const formatTime = (time: number): string => {
    if (isNaN(time)) return "00:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  };

  // Play a single individual word pronunciation instantly
  const playIndividualWord = async (word: string) => {
    if (individualPlayingWord) return; // Prevent double play spamming
    setIndividualPlayingWord(word);
    
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const buffer = await fetchAndDecodeTTS(word, voiceGender, audioCtx);
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = speechRate;
      source.connect(audioCtx.destination);
      source.start(0);
      
      source.onended = () => {
        setIndividualPlayingWord(null);
      };
    } catch (err) {
      console.error("Individual word play failed: ", err);
      setIndividualPlayingWord(null);
    }
  };

  // Checkbox marker
  const toggleWordMark = (word: string, mark: "correct" | "incorrect" | "unmarked") => {
    setWordResults(prev => ({
      ...prev,
      [word]: mark
    }));
  };

  // Score summary
  const scoreStats = () => {
    const total = selectedWords.length;
    if (total === 0) return { correct: 0, incorrect: 0, unmarked: 0 };
    const correct = Object.values(wordResults).filter(v => v === "correct").length;
    const incorrect = Object.values(wordResults).filter(v => v === "incorrect").length;
    const unmarked = Object.values(wordResults).filter(v => v === "unmarked").length;
    return { correct, incorrect, unmarked };
  };

  return (
    <div id="app-root" className="min-h-screen bg-slate-50 text-slate-800 font-sans selection:bg-indigo-100 flex flex-col justify-between">
      
      {/* Decorative top-gradient header wrapper */}
      <header id="app-header" className="bg-gradient-to-r from-slate-900 to-indigo-950 text-white border-b border-indigo-900/40 shadow-md">
        <div className="max-w-6xl mx-auto px-4 py-6 md:py-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div id="header-logo-container" className="p-3 bg-indigo-500/10 rounded-xl border border-indigo-500/30 text-indigo-400">
              <AudioLines className="h-8 w-8 animate-pulse text-indigo-400" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-200 to-white">
                英式英语单词听写生成器
              </h1>
              <p className="text-xs md:text-sm text-slate-400 mt-1">
                自主进行英式发音听写练习 • 自由配置词组数量与循环次数 • 支持一键导出定制PDF书写本
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-300 bg-slate-800/60 px-3 py-1.5 rounded-lg border border-slate-700/50">
            <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
            <span>智能客制化，听力复习与拼写纠正利器</span>
          </div>
        </div>
      </header>

      {/* Hidden browser audio context pipeline */}
      <audio
        ref={audioRef}
        onTimeUpdate={() => {
          if (audioRef.current) {
            setCurrentTime(audioRef.current.currentTime);
          }
        }}
        onDurationChange={() => {
          if (audioRef.current) {
            setDuration(audioRef.current.duration);
          }
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        className="hidden"
      />

      {/* Main Grid Application Stage */}
      <main className="max-w-6xl mx-auto px-4 py-8 flex-1 grid grid-cols-1 lg:grid-cols-12 gap-8 w-full">
        
        {/* Left Side: Parameters, Presets & Batch Upload (7 / 12) */}
        <section id="input-parameters-section" className="col-span-1 lg:col-span-7 flex flex-col gap-6">
          
          {/* Preset list selector */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Layers className="h-5 w-5 text-indigo-600" />
              <h2 className="font-bold text-slate-900 text-base">
                推荐听写单词预设 (Vocab Presets)
              </h2>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              快速载入常用复习词汇库。您也可以在下方框内自由输入/粘贴您自己的单词。
            </p>
            <div className="grid grid-cols-2 gap-3">
              {PRESETS.map((preset) => {
                const wordsJoinedStr = preset.words.slice(0, 4).join(", ") + "...";
                return (
                  <button
                    key={preset.name}
                    onClick={() => loadPreset(preset.words)}
                    className="flex flex-col items-start text-left p-3 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-slate-50 transition duration-150 group"
                  >
                    <span className="font-medium text-xs text-slate-800 group-hover:text-indigo-600 truncate w-full">
                      {preset.name}
                    </span>
                    <span className="text-[10px] text-slate-400 truncate w-full mt-0.5">
                      {wordsJoinedStr} ({preset.words.length}词)
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Words Batch Paste Area */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex-1 flex flex-col min-h-[300px]">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <ListOrdered className="h-5 w-5 text-indigo-600" />
                <h2 className="font-bold text-slate-900 text-base">
                  输入需要听写的单词 (Vocabulary Input)
                </h2>
              </div>
              <span className="text-xs bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full font-medium">
                已识别 {parsedWords.length} 个单词
              </span>
            </div>
            <p className="text-xs text-slate-500 mb-3 leading-relaxed">
              支持换行、空格、中英文逗号隔开多个单词。系统会自动提取其中的英文字符并去重，过滤掉数字等杂质：
            </p>
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="请在这里张贴包含英文单词的文本。例如：
apple, banana, orange
challenge, scientific, opportunity..."
              className="w-full flex-1 p-4 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring focus:ring-indigo-100 placeholder-slate-400 text-sm font-mono overflow-y-auto resize-none bg-slate-50/50 min-h-[160px]"
            />
          </div>

          {/* Detail Settings Card */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
            <h2 className="font-bold text-slate-900 text-base mb-5 flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-indigo-600" />
              听写参数设定 (Configuration)
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
              
              {/* Dictation Word Count Selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wider">
                  本次听写词汇数量
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="1"
                    max={Math.max(1, parsedWords.length)}
                    value={dictationCount}
                    onChange={(e) => setDictationCount(Number(e.target.value))}
                    disabled={parsedWords.length === 0}
                    className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600 disabled:opacity-50"
                  />
                  <span className="font-bold text-indigo-600 text-base bg-indigo-50 px-3 py-1 rounded-lg">
                    {dictationCount}
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 block mt-1">
                  从已识别的 {parsedWords.length} 词中抽取。最大可设置为全部 {parsedWords.length} 词目标
                </span>
              </div>

              {/* Dictation Sequence order */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wider">
                  单词朗读排序方式
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setOrder("random")}
                    className={`py-2 px-3 rounded-lg border text-xs font-medium transition flex items-center justify-center gap-1.5 ${
                      order === "random"
                        ? "border-indigo-600 bg-indigo-50 text-indigo-700 shadow-inner"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <Shuffle className="h-3.5 w-3.5" />
                    <span>乱序（随机挑选）</span>
                  </button>
                  <button
                    onClick={() => setOrder("sequential")}
                    className={`py-2 px-3 rounded-lg border text-xs font-medium transition flex items-center justify-center gap-1.5 ${
                      order === "sequential"
                        ? "border-indigo-600 bg-indigo-50 text-indigo-700 shadow-inner"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                    <span>按顺序（不打乱）</span>
                  </button>
                </div>
              </div>

              {/* Voice Gender Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wider">
                  英音朗读音色 (Accent Gender)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setVoiceGender("female")}
                    className={`py-2 px-3 rounded-lg border text-xs font-medium transition flex items-center justify-center gap-1.5 ${
                      voiceGender === "female"
                        ? "border-indigo-600 bg-indigo-50 text-indigo-700 font-bold"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <span className="text-base">🇬🇧 👩</span>
                    <span>英音 - 女声</span>
                  </button>
                  <button
                    onClick={() => setVoiceGender("male")}
                    className={`py-2 px-3 rounded-lg border text-xs font-medium transition flex items-center justify-center gap-1.5 ${
                      voiceGender === "male"
                        ? "border-indigo-600 bg-indigo-50 text-indigo-700 font-bold"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <span className="text-base">🇬🇧 👨</span>
                    <span>英音 - 男声</span>
                  </button>
                </div>
                <span className="text-[10px] text-slate-400 block mt-1">
                  男声由高品质大模型进行语音合成，女声采用标准英式词典发音。
                </span>
              </div>

              {/* Repeat count selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wider">
                  单复朗读重复次数
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[0, 1, 2].map((num) => {
                    const labelText = num === 0 ? "不重复" : num === 1 ? "读2遍" : "读3遍";
                    return (
                      <button
                        key={num}
                        onClick={() => setRepeatCount(num as any)}
                        className={`py-2 px-1 rounded-lg border text-xs font-medium transition text-center ${
                          repeatCount === num
                            ? "border-indigo-600 bg-indigo-50 text-indigo-700 font-bold"
                            : "border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {labelText}
                      </button>
                    );
                  })}
                </div>
                <span className="text-[10px] text-slate-400 block mt-1">
                  重复朗读发音时，词内留空固定停顿1.5s。
                </span>
              </div>

              {/* Speech rate selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wider">
                  单词发音语速 (Speech Rate)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {([0.8, 1.0, 1.2] as const).map((rate) => {
                    const labelText = rate === 0.8 ? "较慢 0.8x" : rate === 1.0 ? "标准 1.0x" : "较快 1.2x";
                    return (
                      <button
                        key={rate}
                        onClick={() => setSpeechRate(rate)}
                        className={`py-2 px-1 rounded-lg border text-xs font-medium transition text-center ${
                          speechRate === rate
                            ? "border-indigo-600 bg-indigo-50 text-indigo-700 font-bold"
                            : "border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {labelText}
                      </button>
                    );
                  })}
                </div>
                <span className="text-[10px] text-slate-400 block mt-1">
                  智能调节单词的朗読语速，方便不同水平听写。
                </span>
              </div>

              {/* Interval between different words */}
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wider">
                  词与词之间的书写留空时间 (Interval)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[3, 5, 7].map((num) => {
                    return (
                      <button
                        key={num}
                        onClick={() => setIntervalSeconds(num as any)}
                        className={`py-2 px-3 rounded-lg border text-xs font-medium transition flex items-center justify-center gap-1.5 ${
                          intervalSeconds === num
                            ? "border-indigo-600 bg-indigo-50 text-indigo-700 font-bold"
                            : "border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        <Repeat className="h-3.5 w-3.5 text-indigo-400" />
                        <span>{num}秒 (书写延迟)</span>
                      </button>
                    );
                  })}
                </div>
                <span className="text-[10px] text-slate-400 block mt-1.5">
                  高级提示：3秒速度很快（适合拼写高手），5秒节奏适中（复习推荐），7秒较为空旷方便边写边思考。
                </span>
              </div>

            </div>

            {/* Error indicator banner */}
            {errorText && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl mt-5 flex items-center gap-2 text-xs">
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-500" />
                <span>{errorText}</span>
              </div>
            )}

            {/* Big Action Call Trigger */}
            <button
              onClick={handleGenerateDictation}
              disabled={isGenerating || parsedWords.length === 0}
              className={`w-full mt-6 py-4 rounded-xl font-bold text-white flex items-center justify-center gap-2.5 transition transform-active duration-75 shadow-md shadow-indigo-600/10 ${
                isGenerating || parsedWords.length === 0
                  ? "bg-slate-300 pointer-events-none"
                  : "bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer hover:-translate-y-[1px]"
              }`}
            >
              <AudioLines className={`h-5 w-5 ${isGenerating ? "animate-spin" : ""}`} />
              <span>
                {isGenerating ? "正在编译音频中，请稍后 (3~7s)..." : "开始编译一整套听写音频"}
              </span>
            </button>

          </div>

        </section>

        {/* Right Side: Generation Hub, Audio player, Results review & PDF download (5 / 12) */}
        <section id="dictation-results-hub" className="col-span-1 lg:col-span-5 flex flex-col gap-6">

          {/* Loader status for generation */}
          {isGenerating && (
            <div className="bg-white rounded-2xl p-6 border-2 border-indigo-200 shadow-lg text-center flex flex-col items-center justify-center py-12 gap-4">
              <div className="relative flex items-center justify-center">
                <div className="h-12 w-12 rounded-full border-4 border-indigo-100 border-t-indigo-600 animate-spin" />
                <Sparkles className="h-5 w-5 text-indigo-500 absolute animate-pulse" />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-slate-800 text-sm">正在编译音频工程</h3>
                <p className="text-xs text-indigo-600 max-w-xs">{generationProgress}</p>
                <p className="text-[10px] text-slate-400 pt-2">第一次使用时，生成较长的音频可能会有少量时间消耗</p>
              </div>
            </div>
          )}

          {/* Empty initial target message */}
          {!audioUrl && !isGenerating && (
            <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-8 text-center flex flex-col items-center justify-center gap-3">
              <div className="h-12 w-12 bg-slate-100/80 rounded-full flex items-center justify-center text-slate-400">
                <AudioLines className="h-6 w-6" />
              </div>
              <h3 className="font-bold text-slate-700 text-sm">暂无生成的听写音频</h3>
              <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
                请在左侧输入或载入您需要背诵练习的英文词库，配置好发音风格、重复次数和书写间隔，点击生成属于您的定制词库音频！
              </p>
            </div>
          )}

          {/* Active Player Hub Card */}
          {audioUrl && !isGenerating && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 overflow-hidden">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 bg-emerald-500 rounded-full animate-ping" />
                  <h3 className="font-bold text-slate-800 text-sm">听写音频工程已就绪</h3>
                </div>
                <span className="text-[10px] bg-slate-100 text-slate-500 px-2.5 py-1 rounded-md font-mono">
                  {selectedWords.length} Words
                </span>
              </div>

              {/* Word List Sequence Header Metadata */}
              <div className="bg-slate-50 rounded-xl p-4 mb-5 flex flex-col gap-1.5 text-xs text-slate-600">
                <div className="flex justify-between">
                  <span>总计朗读数:</span>
                  <span className="font-medium text-slate-900">{selectedWords.length} 词</span>
                </div>
                <div className="flex justify-between">
                  <span>单词朗读循环:</span>
                  <span className="font-medium text-slate-900">每词播放 {repeatCount + 1} 遍</span>
                </div>
                <div className="flex justify-between">
                  <span>单词朗读语速:</span>
                  <span className="font-medium text-slate-900">
                    {speechRate === 0.8 ? "较慢 (0.8x)" : speechRate === 1.0 ? "标准 (1.0x)" : "较快 (1.2x)"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>词频播放音色:</span>
                  <span className="font-medium text-slate-900">
                    英音- {voiceGender === "female" ? "女声 (Dictionary)" : "男声 ( 대 AI)"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>停顿留空时间:</span>
                  <span className="font-medium text-slate-900">写词动作耗时 {intervalSeconds} 秒</span>
                </div>
              </div>

              {/* Custom Beautiful Audio play control layer */}
              <div className="space-y-4">
                
                {/* Visualizer and seeker */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(duration)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max={duration || 100}
                    value={currentTime}
                    onChange={(e) => handleSeek(Number(e.target.value))}
                    className="w-full h-1 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600 focus:outline-none"
                  />
                </div>

                {/* Primary Button controls */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => skipRelative(-10)}
                      className="p-2 text-slate-400 hover:text-slate-800 hover:bg-slate-50 rounded-lg transition"
                      title="后退10秒"
                    >
                      <RotateCcw className="h-4 w-4 scale-x-[-1]" />
                    </button>
                    <button
                      onClick={() => skipRelative(-5)}
                      className="text-[10px] text-slate-500 hover:bg-slate-50 border border-slate-200 px-2 py-1 rounded"
                    >
                      -5s
                    </button>
                  </div>

                  <button
                    onClick={togglePlayPause}
                    className="h-12 w-12 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center transition shadow-lg shadow-indigo-600/20 active:scale-95 cursor-pointer"
                  >
                    {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 fill-white ml-0.5" />}
                  </button>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => skipRelative(5)}
                      className="text-[10px] text-slate-500 hover:bg-slate-50 border border-slate-200 px-2 py-1 rounded"
                    >
                      +5s
                    </button>
                    <button
                      onClick={() => skipRelative(10)}
                      className="p-2 text-slate-400 hover:text-slate-800 hover:bg-slate-50 rounded-lg transition"
                      title="前进10秒"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Volume slider */}
                <div className="flex items-center gap-2 pt-2 text-slate-400">
                  <Volume2 className="h-4 w-4 shrink-0" />
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={volume}
                    onChange={(e) => handleVolumeChange(Number(e.target.value))}
                    className="w-full h-1 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-slate-600"
                  />
                </div>

                <hr className="border-slate-100 my-4" />

                {/* Download Actions Panel */}
                <div className="grid grid-cols-2 gap-3 text-xs font-semibold pt-1">
                  
                  {/* Download Sound */}
                  <a
                    href={audioUrl || ""}
                    download={`英式英语听写词汇_${selectedWords.length}词.wav`}
                    className="py-3 px-2 text-center rounded-xl border border-indigo-200 hover:border-indigo-600 text-indigo-700 bg-indigo-50/40 hover:bg-indigo-50 hover:-translate-y-[1px] transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Download className="h-4 w-4" />
                    <span>下载听写音频 (.wav)</span>
                  </a>

                  {/* Download PDF WordList */}
                  <button
                    onClick={() => generateDictationPDF(selectedWords, voiceGender, repeatCount, intervalSeconds, order)}
                    className="py-3 px-2 text-center rounded-xl bg-slate-900 hover:bg-slate-800 text-white shadow hover:-translate-y-[1px] transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <FileText className="h-4 w-4" />
                    <span>生成PDF对照词表</span>
                  </button>

                </div>

              </div>
            </div>
          )}

          {/* Results check control table & Compare layout */}
          {selectedWords.length > 0 && !isGenerating && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              
              <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <HelpCircle className="h-5 w-5 text-indigo-600" />
                  <h3 className="font-bold text-slate-800 text-sm">听写单词对照表 check answers</h3>
                </div>
                
                {/* Scoring metrics */}
                {isAnswersVisible && (
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-medium">
                      对: {scoreStats().correct}
                    </span>
                    <span className="bg-rose-50 text-rose-700 px-1.5 py-0.5 rounded font-medium">
                      错: {scoreStats().incorrect}
                    </span>
                  </div>
                )}
              </div>

              {/* Word hide controller to protect student eyes */}
              {!isAnswersVisible ? (
                <div className="space-y-4">
                  <div className="p-4 bg-amber-50/80 border border-amber-200 rounded-xl text-center flex flex-col items-center justify-center gap-3">
                    <EyeOff className="h-7 w-7 text-amber-500 animate-bounce" />
                    <div className="space-y-1">
                      <h4 className="font-bold text-xs text-amber-800">单词拼写当前已隐藏</h4>
                      <p className="text-[10px] text-amber-700 leading-relaxed max-w-xs">
                        为了保障听写练习的真实性，正确的单词列表当前已折叠。请在听写音频播放结束后，点击下方按钮展开对比批改。
                      </p>
                    </div>
                  </div>
                  
                  <button
                    onClick={() => setIsAnswersVisible(true)}
                    className="w-full py-3 rounded-xl border border-slate-200 hover:border-slate-800 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Eye className="h-4 w-4" />
                    <span>展开单词表（开始对照批改）</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-4 animate-fadeIn">
                  
                  <div className="flex items-center justify-between text-xs text-slate-400 pb-1">
                    <span>音频顺序朗读单词对照</span>
                    <button
                      onClick={() => setIsAnswersVisible(false)}
                      className="text-indigo-600 hover:text-indigo-800"
                    >
                      重新隐藏
                    </button>
                  </div>

                  {/* Word List Table Scroll container */}
                  <div className="max-h-[300px] overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-xl">
                    {selectedWords.map((word, wordIndex) => {
                      const checkMarkState = wordResults[word] || "unmarked";
                      return (
                        <div
                          key={`${word}-${wordIndex}`}
                          className="p-3 hover:bg-slate-55 flex items-center justify-between text-xs transition"
                        >
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-slate-400 font-bold bg-slate-100 w-5 h-5 rounded-full flex items-center justify-center text-[10px]">
                              {String(wordIndex + 1).padStart(2, "0")}
                            </span>
                            <span className="font-bold text-slate-900 text-sm select-all">
                              {word}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            {/* Individual Speak Button */}
                            <button
                              onClick={() => playIndividualWord(word)}
                              disabled={individualPlayingWord !== null}
                              className={`px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-[10px] text-slate-600 font-medium transition ${
                                individualPlayingWord === word ? "opacity-40" : ""
                              }`}
                              title="单独朗读此词"
                            >
                              🔊 {individualPlayingWord === word ? "..." : "发音"}
                            </button>

                            {/* Marking check buttons */}
                            <button
                              onClick={() =>
                                toggleWordMark(word, checkMarkState === "correct" ? "unmarked" : "correct")
                              }
                              className={`p-1.5 rounded-lg border transition ${
                                checkMarkState === "correct"
                                  ? "bg-emerald-50 border-emerald-300 text-emerald-600"
                                  : "border-slate-100 hover:bg-slate-50 text-slate-300"
                              }`}
                              title="批改为正确"
                            >
                              <Check className="h-3.5 w-3.5 stroke-[3px]" />
                            </button>

                            <button
                              onClick={() =>
                                toggleWordMark(word, checkMarkState === "incorrect" ? "unmarked" : "incorrect")
                              }
                              className={`p-1.5 rounded-lg border transition ${
                                checkMarkState === "incorrect"
                                  ? "bg-rose-50 border-rose-300 text-rose-600"
                                  : "border-slate-100 hover:bg-slate-50 text-slate-300"
                              }`}
                              title="批改为拼写错误"
                            >
                              <span className="text-[10px] w-3.5 h-3.5 flex items-center justify-center font-bold">
                                ✕
                              </span>
                            </button>

                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Summary scoring evaluation progress bar */}
                  <div className="bg-slate-50 p-3.5 rounded-xl text-xs space-y-2">
                    <div className="flex justify-between items-center text-slate-600">
                      <span>听写练习批改进度：</span>
                      <span className="font-bold text-slate-900">
                        {scoreStats().correct + scoreStats().incorrect} / {selectedWords.length} 已校对
                      </span>
                    </div>
                    
                    {/* Visual metric progress bar */}
                    <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden flex">
                      <div
                        className="bg-emerald-500 h-full transition-all duration-300"
                        style={{
                          width: `${(scoreStats().correct / selectedWords.length) * 100}%`
                        }}
                      />
                      <div
                        className="bg-rose-500 h-full transition-all duration-300"
                        style={{
                          width: `${(scoreStats().incorrect / selectedWords.length) * 100}%`
                        }}
                      />
                    </div>

                    <p className="text-[10px] text-slate-400 leading-normal pt-1 flex items-center gap-1">
                      <Check className="h-3 w-3 text-emerald-500" />
                      点击右侧对钩或叉号来计算您的分值。听写结束后，请点击上方“导出PDF对照词表”来归档拼写本来查漏补缺。
                    </p>
                  </div>

                </div>
              )}

            </div>
          )}

        </section>

      </main>

      {/* Structured Guidelines and FAQ details for aesthetic visual rhythms */}
      <footer id="educational-faq-section" className="bg-slate-900 text-slate-300 py-10 border-t border-slate-800">
        <div className="max-w-6xl mx-auto px-4 grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <h4 className="text-white font-bold text-sm mb-3">英音音色源</h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              系统采用双发音信源：女声调用牛津/剑桥词典的标准原版英音库，男声基于 Google 深度神经语音大模型动态克隆，发音清晰纯正。所有的音频数据生成后均有本地缓存，即使是在复杂网络下也能秒速合成响应。
            </p>
          </div>
          <div>
            <h4 className="text-white font-bold text-sm mb-3">推荐听写范式 (Instruction)</h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              1. 载入词汇集并设定听写数量为 10~20 个；<br />
              2. 朗读重复次数设置为“读2遍”，每词书写留空设定为“5秒”；<br />
              3. 选择“乱序”以排除记忆惰性。点击编译并下载 PDF 纸张打印出来；<br />
              4. 播放音频并进行拼写。拼写完毕点击展开对比对照。
            </p>
          </div>
          <div>
            <h4 className="text-white font-bold text-sm mb-3">WAV 音频格式特点</h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              为了确保最广泛的电子墨水平板、MP3 随身听或手机播放器的无损解码，系统放弃了有损 AAC/MP3 的双层服务器转跳，在浏览器后台直接运行高速 LPCM 二进制编码器合成标准的无压缩 WAV 听写文件。
            </p>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-4 border-t border-slate-800 mt-8 pt-6 text-center text-xs text-slate-500">
          © {new Date().getFullYear()} 英文单词听写音频工程编译系统 (Spelling Dictation Builder). Powered by Web Audio Core and Gemini Engineering.
        </div>
      </footer>
    </div>
  );
}
