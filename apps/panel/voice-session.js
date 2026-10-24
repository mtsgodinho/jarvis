export const VOICE_STATES = Object.freeze({
  OFF: 'off',
  AWAITING: 'awaiting',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  SPEAKING: 'speaking',
  ERROR: 'error',
});

export function extractWakeCommand(transcript) {
  if (typeof transcript !== 'string') return null;
  const match = /^\s*(?:ei\s+)?jarvis\b[\s,.:;!?-]*/i.exec(transcript);
  return match ? { activated: true, command: transcript.slice(match[0].length).trim() } : null;
}

export function createVoiceSession({
  createRecognition,
  onState = () => {},
  onCommand = () => {},
  onError = () => {},
  schedule = setTimeout,
  cancelSchedule = clearTimeout,
  maxRetries = 3,
  retryDelayMs = 500,
} = {}) {
  let enabled = false;
  let singleCommand = false;
  let commandBusy = false;
  let commandArmed = false;
  let recognition = null;
  let retryTimer = null;
  let retryCount = 0;
  let state = VOICE_STATES.OFF;

  const transition = next => {
    state = next;
    onState(next);
  };
  const isActive = () => enabled || singleCommand;

  function detachRecognition() {
    const current = recognition;
    recognition = null;
    if (!current) return;
    current.onstart = null;
    current.onresult = null;
    current.onerror = null;
    current.onend = null;
    try { current.abort(); } catch {}
  }

  function clearRetry() {
    if (retryTimer !== null) cancelSchedule(retryTimer);
    retryTimer = null;
  }

  function disableWithError(code, message) {
    enabled = false;
    singleCommand = false;
    commandBusy = false;
    commandArmed = false;
    clearRetry();
    detachRecognition();
    transition(VOICE_STATES.ERROR);
    onError({ code, message });
  }

  function scheduleRecovery(error) {
    if (!isActive() || commandBusy || retryTimer !== null) return;
    if (error) onError(error);
    if (retryCount >= maxRetries) {
      disableWithError('RECOGNITION_RETRIES_EXHAUSTED',
        'O reconhecimento foi interrompido repetidamente. Verifique o microfone e tente ativar o Jarvis novamente.');
      return;
    }
    retryCount += 1;
    transition(VOICE_STATES.ERROR);
    const delay = retryDelayMs * (2 ** (retryCount - 1));
    retryTimer = schedule(() => {
      retryTimer = null;
      if (isActive() && !commandBusy) startRecognition();
    }, delay);
  }

  function finishCommand(transcript) {
    if (commandBusy || !transcript) return;
    commandBusy = true;
    retryCount = 0;
    const wasSingleCommand = singleCommand;
    singleCommand = false;
    if (wasSingleCommand) enabled = false;
    clearRetry();
    detachRecognition();
    transition(VOICE_STATES.PROCESSING);
    try {
      Promise.resolve(onCommand(transcript)).catch(error => {
        onError({ code: 'COMMAND_FAILED', message: error?.message || 'Não foi possível processar o comando.' });
        resume();
      });
    } catch (error) {
      onError({ code: 'COMMAND_FAILED', message: error?.message || 'Não foi possível processar o comando.' });
      resume();
    }
  }

  function handleResult(current, event) {
    if (recognition !== current || commandBusy || !isActive()) return;
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result?.[0]?.transcript?.trim();
      if (!transcript) continue;
      if (singleCommand) {
        if (result.isFinal) finishCommand(transcript);
        return;
      }
      if (!commandArmed) {
        const activation = extractWakeCommand(transcript);
        if (!activation) continue;
        commandArmed = true;
        transition(VOICE_STATES.LISTENING);
        if (result.isFinal && activation.command) finishCommand(activation.command);
        continue;
      }
      if (result.isFinal) {
        const activation = extractWakeCommand(transcript);
        finishCommand(activation?.command || transcript);
        return;
      }
    }
  }

  function handleRecognitionError(current, event) {
    if (recognition !== current || !isActive()) return;
    recognition = null;
    current.onstart = null;
    current.onresult = null;
    current.onerror = null;
    current.onend = null;
    const code = event?.error || 'RECOGNITION_INTERRUPTED';
    if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'permission-denied') {
      disableWithError('MICROPHONE_PERMISSION_DENIED',
        'O acesso ao microfone foi negado. Autorize o microfone nas permissões deste site/navegador e ative o Jarvis novamente.');
      return;
    }
    const message = code === 'audio-capture'
      ? 'Nenhum microfone disponível. Conecte ou habilite um microfone e tente novamente.'
      : code === 'network'
        ? 'O serviço de reconhecimento perdeu a conexão. Tentando recuperar a escuta.'
        : code === 'no-speech'
          ? ''
          : `O reconhecimento foi interrompido (${code}). Tentando recuperar a escuta.`;
    scheduleRecovery(message ? { code, message } : undefined);
  }

  function startRecognition() {
    if (!isActive() || commandBusy || recognition) return false;
    let current;
    try { current = createRecognition?.(); }
    catch (error) {
      if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
        disableWithError('MICROPHONE_PERMISSION_DENIED',
          'O navegador não autorizou o microfone. Verifique as permissões deste site e tente ativar novamente.');
        return false;
      }
      scheduleRecovery({ code: error?.name || 'RECOGNITION_START_FAILED',
        message: 'Não foi possível iniciar o microfone. Verifique as permissões do navegador.' });
      return false;
    }
    if (!current) {
      disableWithError('RECOGNITION_UNAVAILABLE',
        'Este navegador não disponibiliza reconhecimento de fala. Use a entrada de texto ou outro navegador compatível.');
      return false;
    }
    recognition = current;
    current.lang = 'pt-BR';
    current.continuous = true;
    current.interimResults = true;
    current.maxAlternatives = 1;
    current.onstart = () => {
      if (recognition === current) transition(singleCommand ? VOICE_STATES.LISTENING
        : commandArmed ? VOICE_STATES.LISTENING : VOICE_STATES.AWAITING);
    };
    current.onresult = event => handleResult(current, event);
    current.onerror = event => handleRecognitionError(current, event);
    current.onend = () => {
      if (recognition !== current) return;
      recognition = null;
      scheduleRecovery();
    };
    try {
      current.start();
      return true;
    } catch (error) {
      if (recognition === current) recognition = null;
      current.onstart = null;
      current.onresult = null;
      current.onerror = null;
      current.onend = null;
      if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
        disableWithError('MICROPHONE_PERMISSION_DENIED',
          'O navegador não autorizou o microfone. Verifique as permissões deste site e tente ativar novamente.');
      } else {
        scheduleRecovery({ code: error?.name || 'RECOGNITION_START_FAILED',
          message: 'Não foi possível iniciar o reconhecimento de fala. Tentando novamente.' });
      }
      return false;
    }
  }

  function start() {
    if (enabled || commandBusy) return false;
    if (typeof createRecognition !== 'function') {
      disableWithError('RECOGNITION_UNAVAILABLE', 'Este navegador não disponibiliza reconhecimento de fala.');
      return false;
    }
    clearRetry();
    enabled = true;
    singleCommand = false;
    commandArmed = false;
    retryCount = 0;
    return startRecognition();
  }

  function listenOnce() {
    if (enabled || singleCommand || commandBusy) return false;
    if (typeof createRecognition !== 'function') {
      disableWithError('RECOGNITION_UNAVAILABLE', 'Este navegador não disponibiliza reconhecimento de fala.');
      return false;
    }
    clearRetry();
    singleCommand = true;
    commandArmed = true;
    retryCount = 0;
    return startRecognition();
  }

  function setSpeaking() {
    if (!commandBusy) return false;
    transition(VOICE_STATES.SPEAKING);
    return true;
  }

  function suspend() {
    if (!isActive() || commandBusy) return false;
    commandBusy = true;
    clearRetry();
    detachRecognition();
    transition(VOICE_STATES.PROCESSING);
    return true;
  }

  function resume() {
    if (!commandBusy) return false;
    commandBusy = false;
    commandArmed = false;
    if (!enabled) {
      transition(VOICE_STATES.OFF);
      return false;
    }
    return startRecognition();
  }

  function stop() {
    enabled = false;
    singleCommand = false;
    commandBusy = false;
    commandArmed = false;
    retryCount = 0;
    clearRetry();
    detachRecognition();
    transition(VOICE_STATES.OFF);
  }

  return {
    start,
    listenOnce,
    stop,
    resume,
    suspend,
    setSpeaking,
    get state() { return state; },
    get active() { return isActive(); },
    get processing() { return commandBusy; },
  };
}
