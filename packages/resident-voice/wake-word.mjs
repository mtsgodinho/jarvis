const WAKE_WORD = 'jarvis';

function normalizeWords(value) {
  return value.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
}

export function createWakeWordGate({ clock = Date.now, commandWindowMs = 12000 } = {}) {
  let state = 'awaiting_activation';
  let commandDeadline = 0;

  return {
    get state() {
      return state;
    },
    get commandDeadline() {
      return commandDeadline;
    },
    consume(transcript) {
      if (state === 'disabled' || state === 'processing' || state === 'speaking' || state === 'error' || typeof transcript !== 'string') {
        return null;
      }

      const text = transcript.trim();
      if (!text) return null;
      const words = normalizeWords(text);
      const wakeIndex = words.indexOf(WAKE_WORD);
      if (wakeIndex >= 0) {
        const rawWake = /\bjarvis\b/i.exec(text);
        if (!rawWake) return null;
        const command = text.slice(rawWake.index + rawWake[0].length).replace(/^[\s,.:;!?-]+/u, '').trim();
        if (command) {
          state = 'processing';
          commandDeadline = 0;
          return { type: 'command', command };
        }

        state = 'awaiting_command';
        commandDeadline = clock() + commandWindowMs;
        return { type: 'wake' };
      }

      if (state !== 'awaiting_command') return null;
      if (clock() > commandDeadline) {
        state = 'awaiting_activation';
        commandDeadline = 0;
        return null;
      }

      state = 'processing';
      commandDeadline = 0;
      return { type: 'command', command: text };
    },
    setSpeaking() {
      if (state === 'disabled') return false;
      state = 'speaking';
      commandDeadline = 0;
      return true;
    },
    complete() {
      if (state === 'disabled') return false;
      state = 'awaiting_activation';
      commandDeadline = 0;
      return true;
    },
    disable() {
      state = 'disabled';
      commandDeadline = 0;
    },
    enable() {
      state = 'awaiting_activation';
      commandDeadline = 0;
    },
    fail() {
      state = 'error';
      commandDeadline = 0;
    },
  };
}
