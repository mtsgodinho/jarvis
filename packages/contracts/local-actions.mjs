import { validateFileAction } from '../files/index.mjs';
import { validateWindowAction } from '../desktop/windows-control.mjs';
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
  const fileAction = validateFileAction(action, params);
  if (fileAction) return fileAction;
  const windowAction = validateWindowAction(action, params);
  if (windowAction) return windowAction;

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
  if ((action === 'search_google' || action === 'search_youtube' || action === 'play_youtube' || action === 'play_spotify') && hasOnlyKeys(params, ['query']) &&
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
    case 'files_open': return `Abrir o documento autorizado: ${params.path}`;
    case 'files_list': return `Listar a pasta autorizada: ${params.path || '(raiz)'}`;
    case 'files_read': return `Ler o arquivo autorizado: ${params.path}`;
    case 'files_create': return `Criar ${params.path}, sem sobrescrever arquivos existentes. Conteúdo: ${params.content}`;
    case 'files_move': return `Mover ${params.path} para ${params.destination}, sem sobrescrever arquivos existentes`;
    case 'play_spotify': return `Solicitar reprodução no Spotify: ${params.query}`;
    case 'list_apps': return 'Listar aplicativos autorizados em execução';
    case 'focus_window': return `Alternar para ${params.app}`;
    case 'minimize_window': return `Minimizar ${params.app}`;
    case 'maximize_window': return `Maximizar ${params.app}`;
    case 'close_app': return `Solicitar fechamento de ${params.app}; pode haver alterações não salvas` ;
    case 'restart_windows': return 'Reiniciar o Windows; salve seu trabalho antes de aprovar';
    case 'shutdown_windows': return 'Desligar o Windows; salve seu trabalho antes de aprovar';
    case 'click_control': return `Acionar o controle “${params.control}” em ${params.app}`;
    case 'type_text': return `Preencher “${params.control}” em ${params.app} com: ${params.text}`;
    case 'keyboard_shortcut': return `Atalho ${params.shortcut} em ${params.app}`;
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