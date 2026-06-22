export interface DictationConfig {
  voiceGender: "male" | "female";
  repeatCount: 0 | 1 | 2; // 0: once, 1: twice, 2: three times
  intervalSeconds: 3 | 5 | 7;
  order: "random" | "sequential";
  dictationCount: number;
  speechRate: 0.8 | 1.0 | 1.2;
}

export interface DictationWord {
  id: string;
  word: string;
  phonetic?: string;
  translation?: string;
}

export interface PresetList {
  name: string;
  description: string;
  words: string[];
}
