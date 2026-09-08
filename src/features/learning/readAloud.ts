import { errorResponse, successResponse } from '../../utils/response';

const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const WORD_TOKEN_PATTERN = /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/u;

interface SentenceRow {
  id: string;
  text: string;
  tokens: string;
  pronunciations: string | null;
}

interface StoredPronunciation {
  token_index: number;
  text: string;
  phonemes: string;
}

function parseJson(value: string | null, fallback: unknown): unknown {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function expectedPronunciation(row: SentenceRow): string | null {
  const tokens = parseJson(row.tokens, []);
  const pronunciations = parseJson(row.pronunciations, []);
  if (!Array.isArray(tokens) || !tokens.every(token => typeof token === 'string') || !Array.isArray(pronunciations)) return null;
  const wordIndexes = tokens
    .map((token, index) => WORD_TOKEN_PATTERN.test(token) ? index : -1)
    .filter(index => index >= 0);
  if (wordIndexes.length === 0 || pronunciations.length !== wordIndexes.length) return null;

  const byIndex = new Map<number, StoredPronunciation>();
  for (const item of pronunciations) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
    const value = item as Record<string, unknown>;
    if (!Number.isSafeInteger(value.token_index) || typeof value.text !== 'string' || typeof value.phonemes !== 'string' || !value.phonemes.trim()) return null;
    byIndex.set(value.token_index as number, {
      token_index: value.token_index as number,
      text: value.text,
      phonemes: value.phonemes,
    });
  }

  const words = wordIndexes.map((tokenIndex) => {
    const pronunciation = byIndex.get(tokenIndex);
    if (!pronunciation || pronunciation.text !== tokens[tokenIndex]) return null;
    return {
      text: pronunciation.text,
      graphemes: [{ text: pronunciation.text, phonemes: pronunciation.phonemes.split(/\s+/u).filter(Boolean) }],
    };
  });
  return words.some(word => word === null) ? null : JSON.stringify({ version: 1, words });
}

async function assessmentSentence(env: Env, sentenceId: string, allowUnpublished: boolean): Promise<SentenceRow | null> {
  if (allowUnpublished) {
    return env.DB.prepare('SELECT id, text, tokens, pronunciations FROM sentences WHERE id = ?').bind(sentenceId).first<SentenceRow>();
  }
  return env.DB.prepare(`
    SELECT id, text, tokens, pronunciations FROM sentences
    WHERE id = ? AND (
      EXISTS (
        SELECT 1 FROM passages_runtime runtime
        JOIN passages passage ON passage.id = runtime.passage_id
        WHERE passage.title_sentence_id = sentences.id
      ) OR EXISTS (
        SELECT 1 FROM paragraph_sentences mapping
        JOIN paragraphs paragraph ON paragraph.id = mapping.paragraph_id
        JOIN passages_runtime runtime ON runtime.passage_id = paragraph.passage_id
        WHERE mapping.sentence_id = sentences.id
      )
    )
  `).bind(sentenceId).first<SentenceRow>();
}

export async function handleAssessReadAloud(request: Request, env: Env, origin: string, allowUnpublished = false): Promise<Response> {
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_AUDIO_BYTES + 64 * 1024) {
    return errorResponse(413, 'PAYLOAD_TOO_LARGE', 'Audio tối đa 15 MB', origin);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse(400, 'BAD_REQUEST', 'Cần gửi multipart audio hợp lệ', origin);
  }
  const sentenceId = typeof form.get('sentence_id') === 'string' ? String(form.get('sentence_id')).trim() : '';
  const audio = form.get('audio') as unknown;
  if (!sentenceId || sentenceId.length > 128) return errorResponse(400, 'VALIDATION_ERROR', 'sentence_id không hợp lệ', origin);
  if (!(audio instanceof File) || audio.size === 0) return errorResponse(400, 'VALIDATION_ERROR', 'Thiếu audio ghi âm', origin);
  if (audio.size > MAX_AUDIO_BYTES) return errorResponse(413, 'PAYLOAD_TOO_LARGE', 'Audio tối đa 15 MB', origin);

  const sentence = await assessmentSentence(env, sentenceId, allowUnpublished);
  if (!sentence) return errorResponse(404, 'NOT_FOUND', 'Không tìm thấy câu để luyện đọc', origin);

  const upstreamForm = new FormData();
  upstreamForm.set('text', sentence.text);
  const pronunciation = expectedPronunciation(sentence);
  if (pronunciation) upstreamForm.set('expected_pronunciation', pronunciation);
  upstreamForm.set('audio', audio, audio.name || 'read-aloud.webm');

  try {
    const upstream = await fetch(env.AI_ASSESSMENT_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.AI_INTERNAL_SECRET_KEY}` },
      body: upstreamForm,
    });
    if (!upstream.ok) {
      return errorResponse(upstream.status === 429 ? 429 : 502, 'ASSESSMENT_UNAVAILABLE', 'Chưa thể chấm bài đọc. Hãy thử lại.', origin);
    }
    const result: unknown = await upstream.json();
    return successResponse(200, 'SUCCESS', result, origin);
  } catch {
    return errorResponse(502, 'ASSESSMENT_UNAVAILABLE', 'Chưa thể kết nối dịch vụ chấm điểm. Hãy thử lại.', origin);
  }
}
