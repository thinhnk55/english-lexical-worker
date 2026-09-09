import { errorResponse, successResponse } from '../../utils/response';

const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const SINGLE_WORD_PATTERN = /^[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*$/u;

interface LexicalAssessmentRow {
  id: string;
  text: string;
  phonemes: string | null;
}

function assessmentPhonemes(value: string): string {
  return value.replace(/\s*-\s*/gu, ' ');
}

type LexicalAssessmentKind = 'pronunciation' | 'recognition';

function isResponse(value: File | Response): value is Response {
  return value instanceof Response;
}

function expectedSingleWordPronunciation(lexical: LexicalAssessmentRow): string | null {
  if (!SINGLE_WORD_PATTERN.test(lexical.text.trim()) || !lexical.phonemes?.trim()) return null;
  const phonemes = lexical.phonemes.split(/\s+/u).filter(Boolean);
  if (phonemes.length === 0) return null;
  return JSON.stringify({
    version: 1,
    words: [{
      text: lexical.text.trim(),
      graphemes: [{ text: lexical.text.trim(), phonemes }],
    }],
  });
}

async function assessmentLexical(
  env: Env,
  passageId: string,
  lexicalId: string,
  allowUnpublished: boolean,
): Promise<LexicalAssessmentRow | null> {
  const publishedCondition = allowUnpublished ? '' : `
    AND EXISTS (
      SELECT 1 FROM passages_runtime runtime WHERE runtime.passage_id = owner.passage_id
    )
  `;
  return env.DB.prepare(`
    SELECT lexical.id, lexical.text, lexical.phonemes
    FROM passage_lexicals owner
    JOIN lexicals lexical ON lexical.id = owner.lexical_id
    WHERE owner.passage_id = ? AND lexical.id = ?
    ${publishedCondition}
  `).bind(passageId, lexicalId).first<LexicalAssessmentRow>();
}

async function readAudio(request: Request, origin: string): Promise<File | Response> {
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
  const audio = form.get('audio') as unknown;
  if (!(audio instanceof File) || audio.size === 0) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Thiếu audio ghi âm', origin);
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return errorResponse(413, 'PAYLOAD_TOO_LARGE', 'Audio tối đa 15 MB', origin);
  }
  return audio;
}

async function proxyLexicalAssessment(
  request: Request,
  env: Env,
  origin: string,
  passageId: string,
  lexicalId: string,
  kind: LexicalAssessmentKind,
  allowUnpublished: boolean,
): Promise<Response> {
  if (!passageId || passageId.length > 128 || !lexicalId || lexicalId.length > 128) {
    return errorResponse(400, 'VALIDATION_ERROR', 'passage_id hoặc lexical_id không hợp lệ', origin);
  }
  const audio = await readAudio(request, origin);
  if (isResponse(audio)) return audio;
  const lexical = await assessmentLexical(env, passageId, lexicalId, allowUnpublished);
  if (!lexical) return errorResponse(404, 'NOT_FOUND', 'Không tìm thấy lexical trong passage', origin);

  const upstreamForm = new FormData();
  upstreamForm.set('text', lexical.text);
  if (kind === 'pronunciation' && lexical.phonemes?.trim()) {
    upstreamForm.set('phonemes', assessmentPhonemes(lexical.phonemes.trim()));
  }
  if (kind === 'recognition') {
    const expectedPronunciation = expectedSingleWordPronunciation(lexical);
    if (expectedPronunciation) upstreamForm.set('expected_pronunciation', expectedPronunciation);
  }
  upstreamForm.set('audio', audio, audio.name || `lexical-${kind}.webm`);

  try {
    const upstream = await fetch(
      kind === 'pronunciation' ? env.AI_WORD_ASSESSMENT_URL : env.AI_ASSESSMENT_URL,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.AI_INTERNAL_SECRET_KEY}` },
        body: upstreamForm,
      },
    );
    if (!upstream.ok) {
      return errorResponse(
        upstream.status === 429 ? 429 : 502,
        'ASSESSMENT_UNAVAILABLE',
        kind === 'pronunciation' ? 'Chưa thể chấm phát âm lexical. Hãy thử lại.' : 'Chưa thể nhận diện lexical. Hãy thử lại.',
        origin,
      );
    }
    const result: unknown = await upstream.json();
    return successResponse(200, 'SUCCESS', result, origin);
  } catch {
    return errorResponse(502, 'ASSESSMENT_UNAVAILABLE', 'Chưa thể kết nối dịch vụ chấm điểm. Hãy thử lại.', origin);
  }
}

export function handleAssessLexicalPronunciation(
  request: Request,
  env: Env,
  origin: string,
  passageId: string,
  lexicalId: string,
  allowUnpublished = false,
): Promise<Response> {
  return proxyLexicalAssessment(request, env, origin, passageId, lexicalId, 'pronunciation', allowUnpublished);
}

export function handleAssessLexicalRecognition(
  request: Request,
  env: Env,
  origin: string,
  passageId: string,
  lexicalId: string,
  allowUnpublished = false,
): Promise<Response> {
  return proxyLexicalAssessment(request, env, origin, passageId, lexicalId, 'recognition', allowUnpublished);
}
