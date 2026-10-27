export function normalizeText(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * True when the comment is exactly the phrase: case-insensitive, extra whitespace ignored,
 * optional trailing "!" / "." allowed. Anything else (extra words, prefixes) does not match.
 */
export function matchesPhrase(commentText: string, phrase: string): boolean {
  const text = normalizeText(commentText).replace(/[!.]+$/u, '').trim();
  return text.length > 0 && text === normalizeText(phrase);
}
