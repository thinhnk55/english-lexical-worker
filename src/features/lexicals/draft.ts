export function lexicalDraftMetadata(value: Record<string, unknown>): {
  translations: unknown;
  phonemes: unknown;
} {
  return {
    translations: value.translations === undefined ? {} : value.translations,
    phonemes: value.phonemes === undefined ? null : value.phonemes,
  };
}
