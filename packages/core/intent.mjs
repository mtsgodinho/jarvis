import { findChromeProfile } from './chrome-profiles.mjs';
import { validateLocalAction } from '../contracts/local-actions.mjs';

const OPEN_TARGETS = new Map([
  ['chrome', ['open_chrome']],
  ['google chrome', ['open_chrome']],
  ['microsoft edge', ['open_app', { app: 'edge' }]],
  ['edge', ['open_app', { app: 'edge' }]],
  ['explorador de arquivos', ['open_app', { app: 'explorer' }]],
  ['explorer', ['open_app', { app: 'explorer' }]],
  ['bloco de notas', ['open_app', { app: 'notepad' }]],
  ['notepad', ['open_app', { app: 'notepad' }]],
  ['calculadora', ['open_app', { app: 'calculator' }]],
  ['calculator', ['open_app', { app: 'calculator' }]],
  ['configuracoes', ['open_app', { app: 'settings' }]],
  ['configuracoes do windows', ['open_app', { app: 'settings' }]],
  ['paint', ['open_app', { app: 'paint' }]],
  ['spotify', ['open_app', { app: 'spotify' }]],
  ['visual studio code', ['open_app', { app: 'vscode' }]],
  ['vs code', ['open_app', { app: 'vscode' }]],
  ['vscode', ['open_app', { app: 'vscode' }]],
  ['area de trabalho', ['open_folder', { folder: 'desktop' }]],
  ['desktop', ['open_folder', { folder: 'desktop' }]],
  ['downloads', ['open_folder', { folder: 'downloads' }]],
  ['documentos', ['open_folder', { folder: 'documents' }]],
  ['documents', ['open_folder', { folder: 'documents' }]],
  ['imagens', ['open_folder', { folder: 'pictures' }]],
  ['pictures', ['open_folder', { folder: 'pictures' }]],
  ['videos', ['open_folder', { folder: 'videos' }]],
  ['musicas', ['open_folder', { folder: 'music' }]],
  ['musica', ['open_folder', { folder: 'music' }]],
  ['music', ['open_folder', { folder: 'music' }]],
  ['google', ['open_site', { site: 'google' }]],
  ['youtube', ['open_site', { site: 'youtube' }]],
  ['facebook', ['open_site', { site: 'facebook' }]],
  ['instagram', ['open_site', { site: 'instagram' }]],
  ['gmail', ['open_site', { site: 'gmail' }]],
  ['whatsapp', ['open_site', { site: 'whatsapp' }]],
  ['whatsapp web', ['open_site', { site: 'whatsapp' }]],
  ['github', ['open_site', { site: 'github' }]],
  ['chatgpt', ['open_site', { site: 'chatgpt' }]],
  ['chat gpt', ['open_site', { site: 'chatgpt' }]],
]);

function normalize(message) {
  return message
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^(?:jarvis )+/, '')
    .trim();
}

function stripConversation(message) {
  return message.trim()
    .replace(/^(?:jarvis\b[\s,]*)+/i, '')
    .replace(/[.!?]+\s*$/, '')
    .replace(/\s+(?:por favor|pra mim|para mim|pfv|cara)$/i, '')
    .trim();
}

function detectYoutubeIntent(message) {
  const patterns = [
    ['play_youtube', /^(?:toca|toque|coloca|coloque|bota|bote|reproduz|reproduza|reproduzir)\s+(?:(?:pra|para)\s+tocar\s+)?(.+?)\s+no\s+youtube$/iu],
    ['play_youtube', /^quero\s+(?:ouvir|escutar)\s+(.+?)\s+no\s+youtube$/iu],
    ['search_youtube', /^(?:pesquisa|pesquise|pesquisar|procura|procure|procurar|busca|busque|buscar)\s+(.+?)\s+no\s+youtube$/iu],
    ['search_google', /^(?:pesquisa|pesquise|pesquisar|procura|procure|procurar|busca|busque|buscar)\s+(.+?)\s+no\s+google$/iu],
  ];
  for (const [action, pattern] of patterns) {
    const match = pattern.exec(message);
    if (!match) continue;
    const query = match[1].trim().replace(/^["']|["']$/g, '').trim();
    const validated = validateLocalAction(action, { query });
    if (validated) return validated;
  }
  return null;
}

export function detectContextualLocalAction(message, lastAction) {
  if (typeof message !== 'string' || !lastAction) return null;
  const site = lastAction.action === 'open_site' ? lastAction.params?.site
    : ['search_youtube', 'play_youtube'].includes(lastAction.action) ? 'youtube'
    : lastAction.action === 'search_google' ? 'google' : null;
  if (!['youtube', 'google'].includes(site)) return null;
  const spoken = stripConversation(message);
  const search = /^(?:agora[,\s]+)?(?:pesquisa|pesquise|pesquisar|procura|procure|procurar|busca|busque|buscar)\s+(?:por\s+)?(.+)$/iu.exec(spoken);
  if (!search || /\b(?:no|na|pelo|pela)\s+/iu.test(search[1])) return null;
  return validateLocalAction(site === 'youtube' ? 'search_youtube' : 'search_google', { query: search[1] });
}

export function detectLocalAction(message) {
  if (typeof message !== 'string') return null;
  const spoken = stripConversation(message);
  const normalized = normalize(spoken);

  const volumeValue = /^(?:volume\s+(?:(?:em|para|no)\s+)?|(?:coloca|coloque|bota|bote|deixa|deixe)\s+(?:(?:o|no)\s+)?volume\s+(?:(?:em|para|no)\s+)?)([+-]?\d+(?:[.,]\d+)?)\s*%?$/iu.exec(spoken);
  if (volumeValue) {
    const rawValue = volumeValue[1].replace(',', '.');
    const percent = /^\d+$/.test(rawValue) ? Number(rawValue) : Number.NaN;
    const action = validateLocalAction('set_volume',{percent});
    return action || { action: 'invalid_volume', params: {} };
  }

  const malformedVolume = /^(?:volume\s+.+|(?:coloca|coloque|bota|bote|deixa|deixe)\s+(?:(?:o|no)\s+)?volume\s+.+)$/iu.test(spoken) &&
    /\d|%/.test(spoken);
  if (malformedVolume) return { action: 'invalid_volume', params: {} };

  const maximumVolumePatterns=[
    /^volume\s+(?:no\s+)?maximo$/,
    /^(?:coloca|coloque|bota|bote|deixa|deixe)\s+(?:o\s+)?volume\s+(?:no\s+)?maximo$/,
    /^(?:coloca|coloque|bota|bote|deixa|deixe)\s+no\s+maximo$/,
  ];
  if(maximumVolumePatterns.some(pattern=>pattern.test(normalized))) {
    return validateLocalAction('set_volume',{percent:100});
  }

  const youtubeIntent = detectYoutubeIntent(spoken);
  if (youtubeIntent) return youtubeIntent;

  if (/^(?:abra|abre|abrir) (?:o )?(?:google )?chrome$/.test(normalized)) {
    return 'open_chrome';
  }

  if (/^(?:abra|abre|abrir) (?:o )?meu (?:google )?chrome$/.test(normalized)) {
    return { action: 'open_chrome', profile: findChromeProfile('Mateus'), profileNotFound: false };
  }

  const profileRequest = normalized.match(
    /^(?:abra|abre|abrir) (?:o )?(?:google )?chrome (?:na conta(?: do| da)?|no perfil(?: do| da)?|do|da) (.+)$/,
  );
  if (profileRequest) {
    const profile = findChromeProfile(profileRequest[1]);
    return profile
      ? { action: 'open_chrome', profile, profileNotFound: false }
      : { action: 'open_chrome', profile: null, profileNotFound: true };
  }

  const volumeActions = [
    [/^(?:aumenta|aumente|aumentar|sobe|suba|subir)(?: um pouco)?(?: (?:o )?volume)?$/, 'volume_up'],
    [/^(?:abaixa|abaixe|abaixar|diminui|diminua|diminuir|reduz|reduza|reduzir)(?: um pouco)?(?: (?:o )?volume)?$/, 'volume_down'],
    [/^volume mais alto$/, 'volume_up'],
    [/^volume mais baixo$/, 'volume_down'],
    [/^(?:coloca|coloque|bota|bote) (?:o )?(?:computador )?no mudo$/, 'mute'],
    [/^(?:muta|mute|silencia|silencie) (?:o )?(?:computador|som|audio)?$/, 'mute'],
    [/^(?:tira|retira) (?:o )?(?:som|audio)$/, 'mute'],
    [/^sem som$/, 'mute'],
    [/^(?:tira|tirar|retira|retirar) (?:do )?mudo$/, 'unmute'],
    [/^(?:desmuta|desmutar)$/, 'unmute'],
    [/^(?:desmuta|desmutar|ativa|ative) (?:o )?(?:som|audio)$/, 'unmute'],
    [/^volta (?:o )?som$/, 'unmute'],
    [/^(?:pausa|pause|pausar) (?:a )?(?:musica|reproducao)$/, 'media_play_pause'],
    [/^(?:continua|continue|continuar|retoma|retome|retomar) (?:a )?(?:musica|reproducao)$/, 'media_play_pause'],
    [/^(?:proxima|avance para a proxima) (?:musica|faixa)$/, 'media_next'],
    [/^(?:volta|volte|voltar) (?:a )?(?:musica|faixa)$/, 'media_previous'],
  ];
  for (const [pattern, action] of volumeActions) {
    if (pattern.test(normalized)) return { action, params: {} };
  }

  const openRequest = normalized.match(/^(?:abra|abre|abrir|entra|entre|acessa|acesse|vai|va) (?:(?:o|a|os|as|no|na|nos|nas|meu|minha|meus|minhas) )?(.+)$/);
  if (!openRequest) return null;
  const target = OPEN_TARGETS.get(openRequest[1]);
  if (!target) return null;
  const [action, params] = target;
  if (action === 'open_chrome') {
    return { action: 'open_chrome', profile: findChromeProfile('Mateus'), profileNotFound: false };
  }
  return { action, params };
}
