import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const MAX_RESIDENT_VOICE_DIAGNOSTICS = 20;
export const DEFAULT_RESIDENT_VOICE_DIAGNOSTICS_PATH = fileURLToPath(
  new URL('../../runtime/data/resident-voice-diagnostics.json', import.meta.url),
);

const stages = new Set([
  'settings_read',
  'dotnet_discovery',
  'helper_build',
  'helper_access',
  'helper_start',
  'helper_initialization',
  'recognizer_language',
  'recognizer_create',
  'grammar_compile',
  'microphone_start',
  'recognition_restart',
  'speech_synthesis',
  'speech_playback',
  'service_start',
  'service_runtime',
  'service_stop',
]);
const pendingWrites = new Map();

function validateDiagnostic(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.occurredAt !== 'string' || !Number.isFinite(Date.parse(value.occurredAt)) ||
      typeof value.stage !== 'string' || !stages.has(value.stage) ||
      typeof value.code !== 'string' || !/^[A-Z0-9_]{1,64}$/u.test(value.code) ||
      (value.exceptionType !== null &&
        (typeof value.exceptionType !== 'string' || !/^[A-Za-z0-9_.+`]{1,160}$/u.test(value.exceptionType))) ||
      (value.hresult !== null && (typeof value.hresult !== 'string' || !/^0x[0-9A-F]{8}$/u.test(value.hresult)))) {
    return null;
  }
  return {
    occurredAt: new Date(value.occurredAt).toISOString(),
    stage: value.stage,
    code: value.code,
    exceptionType: value.exceptionType,
    hresult: value.hresult,
  };
}

function sanitizeDiagnostic(value, now) {
  const candidate = {
    occurredAt: typeof value?.occurredAt === 'string' ? value.occurredAt : now().toISOString(),
    stage: value?.stage,
    code: value?.code,
    exceptionType: value?.exceptionType ?? null,
    hresult: value?.hresult ?? null,
  };
  const diagnostic = validateDiagnostic(candidate);
  if (!diagnostic) {
    throw Object.assign(new Error('Resident voice diagnostic is invalid.'), {
      code: 'VOICE_DIAGNOSTIC_INVALID',
    });
  }
  return diagnostic;
}

async function readFileEntries(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    if (!Array.isArray(parsed) || parsed.length > MAX_RESIDENT_VOICE_DIAGNOSTICS) {
      throw Object.assign(new Error('Resident voice diagnostics file is invalid.'), {
        code: 'VOICE_DIAGNOSTICS_INVALID',
      });
    }
    const entries = parsed.map(validateDiagnostic);
    if (entries.some(entry => entry === null)) {
      throw Object.assign(new Error('Resident voice diagnostics file is invalid.'), {
        code: 'VOICE_DIAGNOSTICS_INVALID',
      });
    }
    return entries;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function readResidentVoiceDiagnostics(filePath = DEFAULT_RESIDENT_VOICE_DIAGNOSTICS_PATH) {
  return readFileEntries(filePath);
}

export async function appendResidentVoiceDiagnostic(
  value,
  filePath = DEFAULT_RESIDENT_VOICE_DIAGNOSTICS_PATH,
  { now = () => new Date() } = {},
) {
  const diagnostic = sanitizeDiagnostic(value, now);
  const previousWrite = pendingWrites.get(filePath) || Promise.resolve();
  const currentWrite = previousWrite.then(async () => {
    const entries = await readFileEntries(filePath);
    const retained = [...entries, diagnostic].slice(-MAX_RESIDENT_VOICE_DIAGNOSTICS);
    const directory = path.dirname(filePath);
    const temporaryPath = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    await mkdir(directory, { recursive: true });
    try {
      await writeFile(temporaryPath, `${JSON.stringify(retained, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      await rename(temporaryPath, filePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => {});
      throw error;
    }
    return diagnostic;
  });
  const writeTail = currentWrite.catch(() => {});
  pendingWrites.set(filePath, writeTail);
  try {
    return await currentWrite;
  } finally {
    if (pendingWrites.get(filePath) === writeTail) pendingWrites.delete(filePath);
  }
}
