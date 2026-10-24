import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../apps/local-server/server.mjs';
import { readResidentVoiceDiagnostics } from '../packages/resident-voice/diagnostics.mjs';

test('resident voice settings are authenticated, CSRF-protected, and consent is persisted', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jarvis-resident-http-'));
  const port = 18891;
  const origin = `http://127.0.0.1:${port}`;
  let settings;
  const service = {
    status: { enabled: false, state: 'disabled', microphoneActive: false },
    updateSettings(value) { settings = value; },
    async start(value) {
      settings = value;
      this.status = { enabled: true, state: 'awaiting_activation', microphoneActive: true };
    },
    async stop() {
      this.status = { enabled: false, state: 'disabled', microphoneActive: false };
    },
  };
  const { server } = createServer({requireActionApproval:false,
    port,
    accessCode: 'resident-test',
    residentVoicePlatform: 'win32',
    residentVoiceService: service,
    residentVoiceSettingsPath: path.join(directory, 'voice.json'),
    logger: { warn() {}, error() {} },
  });

  test('resident voice startup failures persist sanitized local diagnostics', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'jarvis-resident-http-diagnostics-'));
    const port = 18892;
    const origin = `http://127.0.0.1:${port}`;
    const service = {
      status: { enabled: false, state: 'disabled', microphoneActive: false },
      updateSettings() {},
      async start() {
        throw Object.assign(new Error('exception message must not be stored'), {
          code: 'MICROPHONE_UNAVAILABLE',
          stage: 'microphone_start',
          exceptionType: 'Windows.Media.SpeechRecognition.SpeechRecognizer',
          hresult: '0x80045509',
          token: 'must-not-be-stored',
        });
      },
      async stop() {},
    };
    const { server } = createServer({requireActionApproval:false,
      port,
      accessCode: 'resident-test',
      residentVoicePlatform: 'win32',
      residentVoiceService: service,
      residentVoiceSettingsPath: path.join(directory, 'voice.json'),
      residentVoiceDiagnosticsPath: path.join(directory, 'diagnostics.json'),
      logger: { info() {}, warn() {}, error() {} },
    });
    await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
    const request = (url, body, headers = {}) => fetch(origin + url, {
      method: body ? 'POST' : 'GET',
      headers: {
        ...(body ? { 'Content-Type': 'application/json', Origin: origin } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    try {
      const login = await request('/api/login', { code: 'resident-test' });
      const cookie = login.headers.get('set-cookie').split(';')[0];
      const session = await (await request('/api/session', null, { Cookie: cookie })).json();
      const response = await request('/api/voice/resident', { enabled: true }, {
        Cookie: cookie,
        'X-Jarvis-CSRF': session.csrf,
      });
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, 'MICROPHONE_UNAVAILABLE');
      const [diagnostic] = await readResidentVoiceDiagnostics(path.join(directory, 'diagnostics.json'));
      assert.equal(diagnostic.stage, 'microphone_start');
      assert.equal(diagnostic.exceptionType, 'Windows.Media.SpeechRecognition.SpeechRecognizer');
      assert.equal(diagnostic.hresult, '0x80045509');
      assert.ok(Number.isFinite(Date.parse(diagnostic.occurredAt)));
      assert.deepEqual(Object.keys(diagnostic).sort(), [
        'code', 'exceptionType', 'hresult', 'occurredAt', 'stage',
      ]);
      const storedFile = await readFile(path.join(directory, 'diagnostics.json'), 'utf8');
      assert.equal(storedFile.includes('must-not-be-stored'), false);
      assert.equal(storedFile.includes('exception message'), false);
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  const request = (url, body, headers = {}) => fetch(origin + url, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(body ? { 'Content-Type': 'application/json', Origin: origin } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  try {
    assert.equal((await request('/api/voice/resident', {})).status, 401);
    const login = await request('/api/login', { code: 'resident-test' });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const session = await (await request('/api/session', null, { Cookie: cookie })).json();
    const headers = { Cookie: cookie, 'X-Jarvis-CSRF': session.csrf };

    const initial = await (await request('/api/voice/resident', null, headers)).json();
    assert.equal(initial.enabled, false);
    assert.equal(initial.microphoneActive, false);
    assert.equal((await request('/api/voice/resident', { enabled: true }, { Cookie: cookie, Origin: origin })).status, 403);
    assert.equal((await request('/api/voice/resident', { enabled: true, volume: 2 }, headers)).status, 400);
    const enabled = await request('/api/voice/resident', { enabled: true, speakingRate: 1.1, volume: 0.7 }, headers);
    assert.equal(enabled.status, 200);
    assert.equal((await enabled.json()).microphoneActive, true);
    assert.equal(settings.enabled, true);

    const disabled = await request('/api/voice/resident', { enabled: false }, headers);
    assert.equal(disabled.status, 200);
    assert.equal((await disabled.json()).enabled, false);
    assert.equal(service.status.microphoneActive, false);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
