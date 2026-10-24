import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { processEnvironment } from '../security/process-environment.mjs';
import { createWakeWordGate } from './wake-word.mjs';

const helperProject = fileURLToPath(new URL('./windows/Jarvis.Voice.Windows.csproj', import.meta.url));
const helperDirectory = path.dirname(helperProject);
const helperExecutable = path.join(helperDirectory, 'bin', 'Release', 'net10.0-windows10.0.19041.0', 'Jarvis.Voice.Windows.exe');
const retryDelays = [1000, 2000, 4000];

function findDotnetPath(env) {
  const candidates = [
    ...String(env.PATH || '').split(path.delimiter).map(folder => path.join(folder, 'dotnet.exe')),
    path.join(env.ProgramFiles || 'C:\\Program Files', 'dotnet', 'dotnet.exe'),
    path.join(env.LOCALAPPDATA || '', 'Microsoft', 'dotnet', 'dotnet.exe'),
  ];
  return candidates.find(candidate => candidate && candidate !== 'dotnet.exe');
}

function runBuild(dotnetPath, { spawnProcess, env }) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(dotnetPath, ['build', helperProject, '--configuration', 'Release', '--verbosity', 'quiet'], {
      cwd: helperDirectory,
      env: processEnvironment(env),
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let diagnostics = '';
    const collect = chunk => {
      diagnostics = `${diagnostics}${chunk.toString('utf8')}`.slice(-6000);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', error => reject(Object.assign(new Error('Não foi possível iniciar a compilação do módulo de voz.'), {
      code: 'VOICE_BUILD_FAILED',
      stage: 'helper_build',
      exceptionType: error.name,
    })));
    child.once('close', code => {
      if (code !== 0) {
        reject(Object.assign(new Error('A compilação do módulo de voz falhou.'), {
          code: 'VOICE_BUILD_FAILED',
          stage: 'helper_build',
          diagnostics: diagnostics.trim(),
        }));
        return;
      }
      resolve();
    });
  });
}

export function createResidentVoiceService({
  platform = process.platform,
  env = process.env,
  spawnProcess = spawn,
  build = runBuild,
  dotnetPath: explicitDotnetPath,
  helperExecutablePath = helperExecutable,
  onState = () => {},
  onTranscript = async () => '',
  onDisable = () => {},
  onError = () => {},
  retryDelays: recoveryDelays = retryDelays,
} = {}) {
  let child = null;
  let enabled = false;
  let shuttingDown = false;
  let pendingCommand = false;
  let activeSpeech = null;
  let retryCount = 0;
  let retryTimer = null;
  let readyTimer = null;
  let startPromise = null;
  let commandWindowTimer = null;
  let readyResolve = null;
  let readyReject = null;
  let lifecycleGeneration = 0;
  let lastState = 'disabled';
  let microphoneActive = false;
  let settings = { speakingRate: 1, volume: 1 };
  const gate = createWakeWordGate();

  const emitState = (state, microphoneActive = false) => onState({
    state,
    microphoneActive,
    wakeState: gate.state,
  });

  const notifyState = (state, active = false) => {
    lastState = state;
    microphoneActive = active;
    emitState(state, active);
    if (state === 'awaiting_activation' && active) readyResolve?.();
  };

  const send = value => {
    if (!child?.stdin?.writable) return false;
    return child.stdin.write(`${JSON.stringify(value)}\n`);
  };

  const say = (text, purpose) => {
    activeSpeech = purpose;
    if (purpose === 'reply') gate.setSpeaking();
    emitState('speaking', false);
    if (!send({ type: 'speak', text, rate: settings.speakingRate, volume: settings.volume })) {
      onError({ code: 'VOICE_BRIDGE_UNAVAILABLE' });
    }
  };

  const clearTimers = () => {
    clearTimeout(readyTimer);
    clearTimeout(retryTimer);
    clearTimeout(commandWindowTimer);
    readyTimer = retryTimer = commandWindowTimer = null;
  };

  const stopChild = async ({ disable = true } = {}) => {
    lifecycleGeneration++;
    enabled = false;
    shuttingDown = true;
    clearTimers();
    readyReject?.(Object.assign(new Error('Ativação residente cancelada.'), { code: 'VOICE_START_CANCELLED' }));
    if (disable) gate.disable();
    if (!child) {
      shuttingDown = false;
      notifyState('disabled', false);
      return;
    }
    const current = child;
    send({ type: 'shutdown' });
    await new Promise(resolve => {
      const timer = setTimeout(() => {
        if (current.exitCode === null) current.kill();
        resolve();
      }, 3000);
      current.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    if (child === current) child = null;
    shuttingDown = false;
    notifyState('disabled', false);
  };

  const processCommand = async command => {
    if (pendingCommand || !enabled) return;
    pendingCommand = true;
    clearTimeout(commandWindowTimer);
    send({ type: 'pause' });
    notifyState('processing', false);
    try {
      const reply = await onTranscript(command);
      if (!enabled || shuttingDown) return;
      say(reply, 'reply');
    } catch {
      if (enabled && !shuttingDown) say('Não consegui concluir o pedido agora. Tente novamente.', 'reply');
      onError({ code: 'VOICE_REQUEST_FAILED' });
    } finally {
      pendingCommand = false;
    }
  };

  const handleMessage = async message => {
    if (!message || typeof message.type !== 'string') return;
    const data = message.data && typeof message.data === 'object' ? message.data : {};
    if (message.type === 'state') {
      if (data.state === 'awaiting_activation') {
        if (activeSpeech === 'reply') {
          activeSpeech = null;
          gate.complete();
        }
        notifyState(gate.state === 'awaiting_command' ? 'awaiting_command' : 'awaiting_activation', data.microphoneActive === true);
      } else {
        notifyState(data.state, data.microphoneActive === true);
      }
      return;
    }
    if (message.type === 'transcript' && typeof data.text === 'string') {
      retryCount = 0;
      const recognition = gate.consume(data.text);
      if (!recognition) return;
      if (recognition.type === 'wake') {
        commandWindowTimer = setTimeout(() => {
          if (gate.state === 'awaiting_command') {
            gate.complete();
            notifyState('awaiting_activation', true);
          }
        }, 12000);
        say('Às suas ordens.', 'wake');
      } else {
        await processCommand(recognition.command);
      }
      return;
    }
    if (message.type === 'speech_complete') {
      if (activeSpeech === 'wake') {
        activeSpeech = null;
      }
      return;
    }
    if (message.type === 'recognition_ended') {
      if (!enabled || shuttingDown || retryTimer) return;
      if (retryCount >= recoveryDelays.length) {
        gate.fail();
        notifyState('error', false);
        onError({ code: 'RECOGNITION_RETRY_LIMIT', stage: 'recognition_restart' });
        return;
      }
      const delay = recoveryDelays[retryCount++];
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (enabled && !shuttingDown) send({ type: 'resume' });
      }, delay);
      return;
    }
    if (message.type === 'disable') {
      await onDisable();
      await stopChild();
      return;
    }
    if (message.type === 'error' && typeof data.code === 'string') {
      if (data.code === 'MICROPHONE_PERMISSION_DENIED') {
        gate.fail();
        notifyState('error', false);
      } else if (['MICROPHONE_UNAVAILABLE', 'PT_BR_RECOGNIZER_UNAVAILABLE', 'RECOGNITION_GRAMMAR_FAILED'].includes(data.code)) {
        gate.fail();
        notifyState('error', false);
      }
      const exceptionType = typeof data.exceptionType === 'string' &&
        /^[A-Za-z0-9_.+`]{1,160}$/u.test(data.exceptionType) ? data.exceptionType : undefined;
      const hresult = typeof data.hresult === 'string' &&
        /^0x[0-9A-F]{8}$/u.test(data.hresult) ? data.hresult : undefined;
      const stage = typeof data.stage === 'string' &&
        /^[a-z_]{1,48}$/u.test(data.stage) ? data.stage : 'service_runtime';
      const details = { code: data.code, exceptionType, hresult, stage };
      if (readyReject) {
        readyReject(Object.assign(new Error('O Windows não conseguiu iniciar a escuta residente.'), details));
      }
      onError(details);
    }
  };

  async function start(nextSettings = settings) {
    if (platform !== 'win32') throw Object.assign(new Error('A escuta residente só está disponível no Windows.'), { code: 'WINDOWS_ONLY' });
    if (enabled && child) return;
    if (startPromise) return startPromise;
    settings = { ...settings, ...nextSettings };
    const generation = ++lifecycleGeneration;
    startPromise = (async () => {
      const dotnetPath = explicitDotnetPath || findDotnetPath(env);
      if (!dotnetPath) throw Object.assign(new Error('Instale o .NET SDK 10 para ativar a voz residente.'), {
        code: 'DOTNET_SDK_MISSING',
        stage: 'dotnet_discovery',
      });
      try {
        await access(dotnetPath);
      } catch (error) {
        throw Object.assign(new Error('O executável do .NET não está acessível.'), {
          code: 'DOTNET_SDK_MISSING',
          stage: 'dotnet_discovery',
          exceptionType: error.name,
        });
      }
      await build(dotnetPath, { spawnProcess, env });
      if (generation !== lifecycleGeneration) return;
      try {
        await access(helperExecutablePath);
      } catch (error) {
        throw Object.assign(new Error('O helper de voz compilado não está acessível.'), {
          code: 'VOICE_HELPER_MISSING',
          stage: 'helper_access',
          exceptionType: error.name,
        });
      }
      enabled = true;
      shuttingDown = false;
      gate.enable();
      notifyState('starting', false);
      child = spawnProcess(helperExecutablePath, [], {
        cwd: helperDirectory,
        env: processEnvironment(env),
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const current = child;
      const lines = createInterface({ input: current.stdout });
      lines.on('line', line => {
        try {
          void handleMessage(JSON.parse(line)).catch(() => onError({ code: 'VOICE_BRIDGE_MESSAGE_FAILED' }));
        } catch {
          onError({ code: 'VOICE_BRIDGE_INVALID_OUTPUT' });
        }
      });
      current.stderr.on('data', () => {});
      current.once('error', error => {
        if (child === current) child = null;
        enabled = false;
        gate.fail();
        notifyState('error', false);
        onError({
          code: 'VOICE_BRIDGE_START_FAILED',
          stage: 'helper_start',
          exceptionType: error.name,
        });
      });
      current.once('close', code => {
        if (child !== current) return;
        child = null;
        if (shuttingDown) return;
        if (readyReject) {
          readyReject(Object.assign(new Error('O módulo residente encerrou durante a inicialização.'), {
            code: 'VOICE_BRIDGE_EXITED',
          }));
          return;
        }
        if (enabled && retryCount < recoveryDelays.length) {
          const delay = recoveryDelays[retryCount++];
          retryTimer = setTimeout(() => {
            retryTimer = null;
            if (enabled && !shuttingDown) {
              void start(settings).catch(() => {
                gate.fail();
                notifyState('error', false);
                onError({ code: 'VOICE_BRIDGE_RESTART_FAILED' });
              });
            }
          }, delay);
          return;
        }
        enabled = false;
        gate.fail();
        notifyState('error', false);
        onError({ code: 'VOICE_BRIDGE_EXITED', exitCode: code ?? 1 });
      });
      await new Promise((resolve, reject) => {
        readyResolve = resolve;
        readyReject = error => reject(error);
        readyTimer = setTimeout(() => {
          readyTimer = null;
          readyReject?.(Object.assign(new Error('O módulo residente não confirmou a ativação do microfone.'), {
            code: 'VOICE_START_TIMEOUT',
            stage: 'helper_start',
          }));
        }, 15000);
      });
    })().finally(() => {
      clearTimeout(readyTimer);
      readyTimer = null;
      readyResolve = readyReject = null;
      startPromise = null;
    });
    return startPromise;
  }

  async function stop() {
    await stopChild();
  }

  function updateSettings(nextSettings) {
    settings = { ...settings, ...nextSettings };
  }

  return {
    start,
    stop,
    updateSettings,
    get status() {
      return { enabled, state: enabled ? lastState : 'disabled', microphoneActive: enabled && microphoneActive };
    },
  };
}
