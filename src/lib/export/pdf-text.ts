/** Standardfontene i PDF (WinAnsi) dekker æ ø å og vanlige tegn; resten byttes ut. */
export function T(s: unknown): string {
  return String(s ?? '')
    .replace(/→|⟶|➜|➔/g, '–')
    .replace(/←/g, '–')
    .replace(/≈/g, 'ca. ')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/[−‐‑]/g, '-')
    .replace(/[   ]/g, ' ')
    .replace(/★/g, '*')
    .replace(/[✓✔]/g, 'OK')
    .replace(/[⚠️]/g, '!')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/g, '');
}

