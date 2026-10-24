export const LOCAL_APPS = Object.freeze({
  chrome: 'Chrome',
  edge: 'Microsoft Edge',
  explorer: 'Explorador de Arquivos',
  notepad: 'Bloco de Notas',
  calculator: 'Calculadora',
  settings: 'Configurações do Windows',
  paint: 'Paint',
  spotify: 'Spotify',
  vscode: 'Visual Studio Code',
});

export const LOCAL_FOLDERS = Object.freeze({
  desktop: 'sua Área de Trabalho',
  downloads: 'seus Downloads',
  documents: 'seus Documentos',
  pictures: 'suas Imagens',
  videos: 'seus Vídeos',
  music: 'suas Músicas',
});

export const LOCAL_SITES = Object.freeze({
  google: { label: 'Google', url: 'https://www.google.com/' },
  youtube: { label: 'YouTube', url: 'https://www.youtube.com/' },
  facebook: { label: 'Facebook', url: 'https://www.facebook.com/' },
  instagram: { label: 'Instagram', url: 'https://www.instagram.com/' },
  gmail: { label: 'Gmail', url: 'https://mail.google.com/' },
  whatsapp: { label: 'WhatsApp Web', url: 'https://web.whatsapp.com/' },
  github: { label: 'GitHub', url: 'https://github.com/' },
  chatgpt: { label: 'ChatGPT', url: 'https://chatgpt.com/' },
});

const EMPTY_PARAMETER_ACTIONS = new Set([
  'volume_up', 'volume_down', 'mute', 'unmute',
  'media_play_pause', 'media_next', 'media_previous',
]);

const VOLUME_ACTIONS = new Set(['volume_up','volume_down','mute','unmute']);

function hasOnlyKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}

export function validateLocalAction(action, params) {
  if (typeof action !== 'string') return null;

  if (action === 'open_app' && hasOnlyKeys(params, ['app']) && Object.hasOwn(LOCAL_APPS, params.app)) {
    return { action, params: { app: params.app } };
  }
  if (action === 'open_folder' && hasOnlyKeys(params, ['folder']) && Object.hasOwn(LOCAL_FOLDERS, params.folder)) {
    return { action, params: { folder: params.folder } };
  }
  if (action === 'open_site' && hasOnlyKeys(params, ['site']) && Object.hasOwn(LOCAL_SITES, params.site)) {
    return { action, params: { site: params.site } };
  }
  if (action === 'set_volume' && hasOnlyKeys(params, ['percent']) && Number.isInteger(params.percent) &&
    params.percent >= 0 && params.percent <= 100) {
    return { action, params: { percent: params.percent } };
  }
  if ((action === 'search_google' || action === 'search_youtube' || action === 'play_youtube') && hasOnlyKeys(params, ['query']) &&
    typeof params.query === 'string' && params.query.trim().length > 0 && params.query.trim().length <= 240 &&
    !/[\u0000-\u001f\u007f]/.test(params.query)) {
    return { action, params: { query: params.query.trim() } };
  }
  if ((EMPTY_PARAMETER_ACTIONS.has(action) || VOLUME_ACTIONS.has(action)) && hasOnlyKeys(params, [])) {
    return { action, params: {} };
  }
  return null;
}

export function localActionConfirmation(action, params) {
  switch (action) {
    case 'open_app': return `Abrindo ${LOCAL_APPS[params.app] === 'Explorador de Arquivos' ? 'o Explorador de Arquivos' :
      params.app === 'calculator' ? 'a Calculadora' : params.app === 'settings' ? 'as Configurações do Windows' :
        params.app === 'notepad' ? 'o Bloco de Notas' : params.app === 'vscode' ? 'o Visual Studio Code' :
          params.app === 'paint' ? 'o Paint' : params.app === 'edge' ? 'o Microsoft Edge' : `o ${LOCAL_APPS[params.app]}`}.`;
    case 'open_folder': return `Abrindo ${LOCAL_FOLDERS[params.folder]}.`;
    case 'open_site': return `Abrindo ${LOCAL_SITES[params.site].label}.`;
    case 'set_volume': return `Volume ajustado para ${params.percent}%.`;
    case 'search_google': return `Pesquisando ${params.query} no Google.`;
    case 'search_youtube': return `Pesquisando ${params.query} no YouTube.`;
    case 'play_youtube': return `Tocando ${params.query} no YouTube.`;
    case 'volume_up': return 'Volume aumentado.';
    case 'volume_down': return 'Volume reduzido.';
    case 'mute': return 'Som desativado.';
    case 'unmute': return 'Som ativado.';
    case 'media_play_pause': return 'Alternando a reprodução.';
    case 'media_next': return 'Avançando para a próxima faixa.';
    case 'media_previous': return 'Voltando para a faixa anterior.';
    default: return null;
  }
}