/**
 * Standardfontene i PDF (WinAnsi) dekker æ ø å og vanlige tegn; resten byttes ut.
 * Spesialtegn er skrevet som unicode-koder så filen er entydig uansett editor.
 */
// tegn utenfor Latin-1 som WinAnsi likevel har (euro, typografiske anførselstegn, tankestreker, S/Z med hake, OE, Y med tødler)
const WINANSI_EXTRA = '\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178';
const NOT_WINANSI = new RegExp(`[^\\x09\\x0a\\x0d\\x20-\\x7e\\xa0-\\xff${WINANSI_EXTRA}]`, 'g');

export function T(s: unknown): string {
  return String(s ?? '')
    .replace(/\u2192|\u27F6|\u279C|\u2794|\u2190/g, '\u2013') // piler blir tankestrek
    .replace(/\u2248/g, 'ca. ') // omtrent lik
    .replace(/\u2265/g, '>=')
    .replace(/\u2264/g, '<=')
    .replace(/\u2212|\u2010|\u2011/g, '-') // minus og bindestrek-varianter
    .replace(/\u202F|\u2009|\u2007/g, ' ') // smale mellomrom (tallformatering)
    .replace(/\u2605/g, '*') // stjerne
    .replace(/\u2713|\u2714/g, 'OK') // hake
    .replace(/\u26A0\uFE0F?/g, '!') // varseltrekant
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]|\uFE0F|\u200D/gu, '') // emoji
    .replace(NOT_WINANSI, '');
}
