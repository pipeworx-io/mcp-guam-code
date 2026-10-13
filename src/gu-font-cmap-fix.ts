/**
 * The ONE Guam-specific delta kept after folding this pack's pdf-text.ts
 * fork into the shared extractor (fleet #2888 -> #2904). Everything else
 * `gu-pdf-extract.ts` used to carry — literal strings routed through a
 * font's /ToUnicode map, the overlong-/Length retry against trailing junk,
 * and the fire-and-forget `inflate()` unhandled rejection — was folded into
 * `shared/src/pdf-text.ts` itself because none of it was actually
 * Guam-specific. This one piece genuinely is, so it has nowhere else to
 * live:
 *
 * One embedded symbol font per chapter PDF (`...+WPTypographicSymbols`,
 * used only for that chapter's curly quote marks) carries a `/ToUnicode`
 * CMap that is itself WRONG in Guam's own published source file — code 1
 * (meant to be a left double curly quote) maps to U+0041 ('A') and code 2
 * (right curly quote) maps to U+0040 ('@'). Confirmed by eye against
 * surrounding text: "ADirector of Public Safety@" in a raw extraction is
 * exactly "“Director of Public Safety”" with those two codes substituted
 * back — the unmistakably intended reading, reproduced by any PDF viewer's
 * own copy-paste. This is a defect in the SOURCE PDF, not something a
 * general-purpose extractor could detect from first principles, so it is
 * corrected here by font name rather than generalized into the shared file.
 *
 * Pass this as `shared/src/pdf-text.ts`'s `fontCMapOverride` option — it is
 * called with every font's own dictionary text and its freshly parsed
 * `/ToUnicode` map, right before that map is used to decode any text, and
 * may return a replacement map to override specific codes.
 */
export function guamFontCMapOverride(fontDict: string, map: Map<number, number>): Map<number, number> | void {
  if (!/WPTypographicSymbols/.test(fontDict)) return;
  const fixed = new Map(map);
  fixed.set(1, 0x201c);
  fixed.set(2, 0x201d);
  return fixed;
}
