import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  DEFAULT_RESIDENT_VOICE_SETTINGS,
  readResidentVoiceSettings,
  validateResidentVoiceSettings,
  writeResidentVoiceSettings,
} from '../packages/resident-voice/settings.mjs';
import { createWakeWordGate } from '../packages/resident-voice/wake-word.mjs';
import { createResidentVoiceService } from '../packages/resident-voice/service.mjs';
import {
  MAX_RESIDENT_VOICE_DIAGNOSTICS,
  appendResidentVoiceDiagnostic,
  readResidentVoiceDiagnostics,
} from '../packages/resident-voice/diagnostics.mjs';

test('wake word accepts a complete command and strips only the activation word', () => {
  const gate = createWakeWordGate();
  assert.deepEqual(gate.consume('Jarvis, abra o Spotify.'), {
    type: 'command',
    command: 'abra o Spotify.',
  });
  assert.equal(gate.state, 'processing');
});

test('wake word requires Jarvis as a separate token', () => {
  const gate = createWakeWordGate();
  assert.equal(gate.consume('viajarvis, abra o Spotify'), null);
  assert.equal(gate.consume('jarvisness'), null);
  assert.equal(gate.state, 'awaiting_activation');
});

test('wake word arms one follow-up phrase and then returns to standby', () => {
  let now = 100;
  const gate = createWakeWordGate({ clock: () => now, commandWindowMs: 12000 });
  assert.deepEqual(gate.consume('Jarvis.'), { type: 'wake' });
  assert.equal(gate.state, 'awaiting_command');
  assert.deepEqual(gate.consume('Aumenta o volume.'), {
    type: 'command',
    command: 'Aumenta o volume.',
  });
  assert.equal(gate.consume('aumenta o volume'), null);
  gate.complete();
  assert.equal(gate.state, 'awaiting_activation');
  assert.deepEqual(gate.consume('JARVIS, que horas são?'), {
    type: 'command',
    command: 'que horas são?',
  });
  now += 13000;
  gate.complete();
  assert.deepEqual(gate.consume('Jarvis'), { type: 'wake' });
  now += 12001;
  assert.equal(gate.consume('abre o Chrome'), null);
  assert.equal(gate.state, 'awaiting_activation');
});

test('wake gate ignores repeated transcripts while processing or speaking', () => {
  const gate = createWakeWordGate();
  assert.deepEqual(gate.consume('Jarvis, abre o Chrome'), {
    type: 'command',
    command: 'abre o Chrome',
  });
  assert.equal(gate.consume('Jarvis, abre o Spotify'), null);
  gate.setSpeaking();
  assert.equal(gate.consume('Jarvis'), null);
  gate.complete();
  assert.equal(gate.state, 'awaiting_activation');
});

test('disable and error states never accept wake words until explicitly enabled', () => {
  const gate = createWakeWordGate();
  gate.disable();
  assert.equal(gate.consume('Jarvis'), null);
  gate.fail();
  assert.equal(gate.consume('Jarvis'), null);
  gate.enable();
  assert.deepEqual(gate.consume('Jarvis'), { type: 'wake' });
});

test('resident voice settings default to off and reject out-of-range controls', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jarvis-resident-voice-'));
  const filePath = path.join(directory, 'voice.json');
  try {
    assert.deepEqual(await readResidentVoiceSettings(filePath), DEFAULT_RESIDENT_VOICE_SETTINGS);
    assert.equal(validateResidentVoiceSettings({ enabled: true, speakingRate: 2, volume: 1 }), null);
    assert.equal(validateResidentVoiceSettings({ enabled: true, speakingRate: 1, volume: -1 }), null);
    const saved = { enabled: true, speakingRate: 1.15, volume: 0.65 };
    await writeResidentVoiceSettings(saved, filePath);
    assert.deepEqual(await readResidentVoiceSettings(filePath), saved);
    assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), saved);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('resident voice diagnostics persist only allowlisted metadata and retain the newest entries', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jarvis-resident-diagnostics-store-'));
  const filePath = path.join(directory, 'diagnostics.json');
  const now = () => new Date('2026-10-21T04:00:00.000Z');
  try {
    for (let count = 0; count < MAX_RESIDENT_VOICE_DIAGNOSTICS + 3; count++) {
      await appendResidentVoiceDiagnostic({
        stage: 'microphone_start',
        code: 'MICROPHONE_UNAVAILABLE',
        exceptionType: 'Windows.Media.SpeechRecognition.SpeechRecognizer',
        hresult: '0x80045509',
        token: 'must-not-be-persisted',
        message: 'sensitive data must not be persisted',
      }, filePath, { now });
    }

    const diagnostics = await readResidentVoiceDiagnostics(filePath);
    assert.equal(diagnostics.length, MAX_RESIDENT_VOICE_DIAGNOSTICS);
    assert.deepEqual(diagnostics.at(-1), {
      occurredAt: '2026-10-21T04:00:00.000Z',
      stage: 'microphone_start',
      code: 'MICROPHONE_UNAVAILABLE',
      exceptionType: 'Windows.Media.SpeechRecognition.SpeechRecognizer',
      hresult: '0x80045509',
    });
    const storedFile = await readFile(filePath, 'utf8');
    assert.equal(storedFile.includes('must-not-be-persisted'), false);
    assert.equal(storedFile.includes('sensitive data'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('resident voice diagnostics reject arbitrary stages and malformed HRESULT values', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jarvis-resident-diagnostics-invalid-'));
  const filePath = path.join(directory, 'diagnostics.json');
  try {
    await assert.rejects(appendResidentVoiceDiagnostic({
      stage: 'microphone_start; token=secret',
      code: 'MICROPHONE_UNAVAILABLE',
      exceptionType: null,
      hresult: null,
    }, filePath), { code: 'VOICE_DIAGNOSTIC_INVALID' });
    await assert.rejects(appendResidentVoiceDiagnostic({
      stage: 'microphone_start',
      code: 'MICROPHONE_UNAVAILABLE',
      exceptionType: 'System.Exception',
      hresult: 'access-token',
    }, filePath), { code: 'VOICE_DIAGNOSTIC_INVALID' });
    assert.deepEqual(await readResidentVoiceDiagnostics(filePath), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('resident service prevents duplicate processes and ignores commands without wake word', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jarvis-resident-service-'));
  const helperPath = path.join(directory, 'helper.exe');
  await writeFile(helperPath, 'test');
  let buildCount = 0;
  let spawnCount = 0;
  const requests = [];
  let child;
  const service = createResidentVoiceService({
    platform: 'win32',
    dotnetPath: process.execPath,
    helperExecutablePath: helperPath,
    build: async () => { buildCount++; },
    spawnProcess: () => {
      spawnCount++;
      child = new EventEmitter();
      child.exitCode = null;
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin.on('data', chunk => {
        const messages = chunk.toString().trim().split('\n').map(line => JSON.parse(line));
        requests.push(...messages);
        if (messages.some(message => message.type === 'shutdown')) setImmediate(() => child.kill());
      });
      child.kill = () => {
        child.exitCode = 0;
        child.stdout.end();
        child.stderr.end();
        child.emit('close', 0);
      };
      setImmediate(() => child.stdout.write(`${JSON.stringify({
        type: 'state',
        data: { state: 'awaiting_activation', microphoneActive: true },
      })}\n`));
      return child;
    },
    onTranscript: async text => `Recebi: ${text}`,
  });

  try {
    await service.start();
    await service.start();
    assert.equal(spawnCount, 1);
    assert.equal(buildCount, 1);
    child.stdout.write(`${JSON.stringify({ type: 'transcript', data: { text: 'abre o Chrome' } })}\n`);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(requests.some(request => request.type === 'speak'), false);
    child.stdout.write(`${JSON.stringify({ type: 'transcript', data: { text: 'Jarvis, abre o Chrome' } })}\n`);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(requests.some(request => request.type === 'pause'));
    assert.ok(requests.some(request => request.type === 'speak' && request.text === 'Recebi: abre o Chrome'));
  } finally {
    await service.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('resident service refuses to start outside Windows', async () => {
  const service = createResidentVoiceService({ platform: 'linux' });
  await assert.rejects(service.start(), { code: 'WINDOWS_ONLY' });
});

test('resident service surfaces the Windows exception type and HRESULT on startup failure', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jarvis-resident-diagnostics-'));
  const helperPath = path.join(directory, 'helper.exe');
  await writeFile(helperPath, 'test');
  let child;
  const reportedErrors = [];
  const service = createResidentVoiceService({
    platform: 'win32',
    dotnetPath: process.execPath,
    helperExecutablePath: helperPath,
    build: async () => {},
    spawnProcess: () => {
      child = new EventEmitter();
      child.exitCode = null;
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin.on('data', chunk => {
        const messages = chunk.toString().trim().split('\n').map(line => JSON.parse(line));
        if (messages.some(message => message.type === 'shutdown')) setImmediate(() => child.kill());
      });
      child.kill = () => {
        child.exitCode = 0;
        child.stdout.end();
        child.stderr.end();
        child.emit('close', 0);
      };
      setImmediate(() => child.stdout.write(`${JSON.stringify({
        type: 'error',
        data: {
          code: 'MICROPHONE_UNAVAILABLE',
          exceptionType: 'Windows.Media.SpeechRecognition.SpeechRecognizer',
          hresult: '0x80045509',
          message: 'this field must not be forwarded',
        },
      })}\n`));
      return child;
    },
    onError: error => reportedErrors.push(error),
  });

  try {
    await assert.rejects(service.start(), {
      code: 'MICROPHONE_UNAVAILABLE',
      exceptionType: 'Windows.Media.SpeechRecognition.SpeechRecognizer',
      hresult: '0x80045509',
    });
    assert.deepEqual(reportedErrors, [{
      code: 'MICROPHONE_UNAVAILABLE',
      exceptionType: 'Windows.Media.SpeechRecognition.SpeechRecognizer',
      hresult: '0x80045509',
      stage: 'service_runtime',
    }]);
  } finally {
    await service.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('resident service bounds repeated recognition failures and exposes the error state', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jarvis-resident-recovery-'));
  const helperPath = path.join(directory, 'helper.exe');
  await writeFile(helperPath, 'test');
  const requests = [];
  let child;
  let resolveErrorState;
  const errorState = new Promise(resolve => { resolveErrorState = resolve; });
  let recoveryTimeout;
  const service = createResidentVoiceService({
    platform: 'win32',
    dotnetPath: process.execPath,
    helperExecutablePath: helperPath,
    retryDelays: [1, 1],
    build: async () => {},
    onState: state => {
      if (state.state === 'error') resolveErrorState();
    },
    spawnProcess: () => {
      child = new EventEmitter();
      child.exitCode = null;
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin.on('data', chunk => {
        const messages = chunk.toString().trim().split('\n').map(line => JSON.parse(line));
        requests.push(...messages);
        if (messages.some(message => message.type === 'resume')) {
          setImmediate(() => {
            child.stdout.write(`${JSON.stringify({
              type: 'state',
              data: { state: 'awaiting_activation', microphoneActive: true },
            })}\n`);
            child.stdout.write(`${JSON.stringify({ type: 'recognition_ended', data: {} })}\n`);
          });
        }
        if (messages.some(message => message.type === 'shutdown')) setImmediate(() => child.kill());
      });
      child.kill = () => {
        child.exitCode = 0;
        child.stdout.end();
        child.stderr.end();
        child.emit('close', 0);
      };
      setImmediate(() => {
        child.stdout.write(`${JSON.stringify({
          type: 'state',
          data: { state: 'awaiting_activation', microphoneActive: true },
        })}\n`);
        child.stdout.write(`${JSON.stringify({ type: 'recognition_ended', data: {} })}\n`);
      });
      return child;
    },
  });

  try {
    await service.start();
    await Promise.race([
      errorState,
      new Promise((_, reject) => { recoveryTimeout = setTimeout(() => reject(new Error('Recognition recovery did not stop.')), 1000); }),
    ]);
    clearTimeout(recoveryTimeout);
    assert.equal(service.status.state, 'error');
    assert.equal(requests.filter(request => request.type === 'resume').length, 2);
  } finally {
    clearTimeout(recoveryTimeout);
    await service.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
