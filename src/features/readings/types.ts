export interface ReadingRow {
  id: string;
  title_sentence_id: string;
}

export interface ReadingSentenceRow {
  reading_id: string;
  sentence_id: string;
  position: number;
}
