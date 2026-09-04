export const LEXICAL_TYPES = [
  'vocabulary',
  'phrase',
  'collocation',
  'phrasal_verb',
  'idiom',
  'pattern',
] as const;

export type LexicalType = typeof LEXICAL_TYPES[number];

export function isLexicalType(value: string): value is LexicalType {
  return (LEXICAL_TYPES as readonly string[]).includes(value);
}

export function normalizeLexicalText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}
