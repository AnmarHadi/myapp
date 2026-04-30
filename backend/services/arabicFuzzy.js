function normalizeArabicLoose(text = '') {
  return String(text)
    .replace(/[\u0625\u0623\u0622\u0627]/g, '\u0627')
    .replace(/\u0649/g, '\u064a')
    .replace(/\u0629/g, '\u0647')
    .replace(/[^\u0600-\u06FF\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function repairBrokenWords(text = '') {
  return String(text)
    .replace(/\u0627\u0644\u0630\s+\u0647\u0628\u064a/g, '\u0627\u0644\u0630\u0647\u0628\u064a')
    .replace(/\u0627\u0644\u0630\s+\u0647\s+\u0628\u064a/g, '\u0627\u0644\u0630\u0647\u0628\u064a')
    .replace(/\u0645\u0635\u0641\s+\u0649/g, '\u0645\u0635\u0641\u0649')
    .replace(/\u0646\u0641\s+\u0637/g, '\u0646\u0641\u0637')
    .replace(/\u0627\u0644\u0646\u0644\u0637/g, '\u0627\u0644\u0646\u0641\u0637')
    .replace(/\u0627\u0644\u0641\u0646\u0637/g, '\u0627\u0644\u0646\u0641\u0637');
}

function smartContains(text, word) {
  const t = normalizeArabicLoose(text);
  const w = normalizeArabicLoose(word);

  if (t.includes(w)) return true;

  const pattern = w.split('').join('\\s*');
  return new RegExp(pattern).test(t);
}

function isGoldenRefinery(text = '') {
  const t = repairBrokenWords(text);
  const normalized = normalizeArabicLoose(t);

  const hasOilSignal =
    smartContains(t, '\u0627\u0644\u0646\u0641\u0637') ||
    smartContains(t, '\u0627\u0644\u0646\u0644\u0637') ||
    smartContains(t, '\u0627\u0644\u0641\u0646\u0637');
  const hasGoldenSignal =
    smartContains(t, '\u0627\u0644\u0630\u0647\u0628\u064a') ||
    smartContains(t, '\u0627\u0644\u0630\u0647\u0628\u064a\u0629') ||
    smartContains(t, '\u0627\u0644\u0630\u0647\u0628');
  const hasRefinerySignal =
    smartContains(t, '\u0645\u0635\u0641\u0649') ||
    smartContains(t, '\u0645\u0635\u0641\u0627\u0629') ||
    smartContains(t, '\u0645\u0639\u0645\u0644') ||
    normalized.includes(normalizeArabicLoose('\u0645. \u0627\u0644\u0646\u0641\u0637')) ||
    normalized.includes(normalizeArabicLoose('\u0645.\u0627\u0644\u0646\u0641\u0637'));
  const hasGoldenHoldingSignal =
    smartContains(t, '\u0627\u0644\u0630\u0647\u0628\u064a\u0629 \u0627\u0644\u0642\u0627\u0628\u0636\u0629') ||
    (smartContains(t, '\u0627\u0644\u0630\u0647\u0628\u064a\u0629') && smartContains(t, '\u0627\u0644\u0642\u0627\u0628\u0636\u0629'));

  const hasNetworkGoldenSignal =
    smartContains(t, '\u0627\u0644\u0634\u0628\u0643\u0629 \u0627\u0644\u0630\u0647\u0628\u064a\u0629') ||
    (smartContains(t, '\u0627\u0644\u0634\u0628\u0643\u0629') && hasGoldenSignal);

  return (
    (hasOilSignal && hasGoldenSignal && (hasRefinerySignal || hasGoldenHoldingSignal)) ||
    (hasNetworkGoldenSignal && hasRefinerySignal) ||
    (hasNetworkGoldenSignal && hasGoldenHoldingSignal)
  );
}

module.exports = {
  isGoldenRefinery,
  repairBrokenWords,
};
