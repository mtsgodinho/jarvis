function isPortuguese(voice) {
  return typeof voice?.lang === 'string' && /^pt(?:-|$)/i.test(voice.lang);
}

function isBrazilianPortuguese(voice) {
  return typeof voice?.lang === 'string' && /^pt[-_]br$/i.test(voice.lang);
}

function isMasculineVoice(voice) {
  return /(?:masculin|male|homem|daniel|antonio|ant[oô]nio|lucas|ricardo|paulo|felipe)/i
    .test(`${voice?.name || ''} ${voice?.gender || ''}`);
}

export function selectPortugueseVoice(voices = []) {
  return voices
    .filter(isPortuguese)
    .sort((left, right) =>
      Number(isBrazilianPortuguese(right)) - Number(isBrazilianPortuguese(left)) ||
      Number(isMasculineVoice(right)) - Number(isMasculineVoice(left)) ||
      Number(/(?:natural|neural|enhanced)/i.test(right.name || '')) -
        Number(/(?:natural|neural|enhanced)/i.test(left.name || '')) ||
      Number(Boolean(right.default)) - Number(Boolean(left.default)))[0];
}
