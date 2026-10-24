// Grapheme clusters: what a reader sees as one character. An emoji with a
// skin tone, a flag or a family joined with ZWJ is one cluster of several
// code points, and cutting inside one leaves a broken or different symbol.
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

const MEASURES = {
  // What a form field's maxlength counts.
  units: (segment) => segment.length,
  codepoints: (segment) => Array.from(segment).length,
};

// The longest start of `text` of at most `max` in the given measure that
// ends on a cluster boundary, so a limit drops a whole emoji rather than
// half of one.
export function clipText(text, max, measure = 'units') {
  const size = MEASURES[measure];
  if (size(text) <= max) return text;
  let length = 0;
  let out = '';
  for (const { segment } of graphemes.segment(text)) {
    length += size(segment);
    if (length > max) break;
    out += segment;
  }
  return out;
}
