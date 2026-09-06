export function passageDraftFromText(content: string): Record<string, unknown> | null {
  const blocks = content
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/u)
    .map(block => block.trim())
    .filter(Boolean);
  if (blocks.length === 0) return null;
  const firstLines = blocks[0].split('\n').map(line => line.trim()).filter(Boolean);
  const title = firstLines.shift();
  if (!title) return null;
  const paragraphTexts = [firstLines.join(' '), ...blocks.slice(1)].filter(Boolean);
  return {
    title: { text: title, lexicals: [] },
    paragraphs: paragraphTexts.map(paragraph => ({
      sentences: paragraph
        .split(/(?<=[.!?])\s+(?=[A-Z0-9“‘"'])/u)
        .map(sentence => sentence.trim())
        .filter(Boolean)
        .map(sentence => ({ text: sentence, lexicals: [] })),
    })),
  };
}
