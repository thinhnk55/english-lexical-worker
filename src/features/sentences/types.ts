export interface SentenceRow {
  id: string;
  text: string;
  tokens: string | null;
  translations: string | null;
  phonemes: string | null;
  pronunciations: string | null;
  audio: string | null;
  image: string | null;
}

export type PronunciationSource = 'single' | 'rule' | 'policy' | 'manual';

export interface SentencePronunciation {
  token_index: number;
  text: string;
  variant: number | null;
  phonemes: string;
  source: PronunciationSource;
}

export interface SentenceLexicalRow {
  id: string;
  sentence_id: string;
  lexical_id: string;
  position: number;
  token_indexes: string;
}

export interface Sentence {
  id: string;
  text: string;
  tokens: string[];
  translations: Record<string, string> | null;
  phonemes: string | null;
  pronunciations: SentencePronunciation[];
  audio: string | null;
  image: string | null;
}

export interface SentenceLexical {
  id: string;
  sentence_id: string;
  lexical_id: string;
  position: number;
  token_indexes: number[];
}
