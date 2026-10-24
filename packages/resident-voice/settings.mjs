import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const DEFAULT_RESIDENT_VOICE_SETTINGS = Object.freeze({
  enabled: false,
  speakingRate: 1,
  volume: 1,
});

export const DEFAULT_RESIDENT_VOICE_SETTINGS_PATH = fileURLToPath(
  new URL('../../runtime/data/resident-voice.json', import.meta.url),
);

export function validateResidentVoiceSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !['enabled', 'speakingRate', 'volume'].includes(key)) ||
      typeof value.enabled !== 'boolean' ||
      typeof value.speakingRate !== 'number' || !Number.isFinite(value.speakingRate) || value.speakingRate < 0.75 || value.speakingRate > 1.25 ||
      typeof value.volume !== 'number' || !Number.isFinite(value.volume) || value.volume < 0 || value.volume > 1) {
    return null;
  }
  return { enabled: value.enabled, speakingRate: value.speakingRate, volume: value.volume };
}

export async function readResidentVoiceSettings(filePath = DEFAULT_RESIDENT_VOICE_SETTINGS_PATH) {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    const settings = validateResidentVoiceSettings(parsed);
    if (!settings) throw Object.assign(new Error('Resident voice settings are invalid.'), { code: 'VOICE_SETTINGS_INVALID' });
    return settings;
  } catch (error) {
    if (error.code === 'ENOENT') return { ...DEFAULT_RESIDENT_VOICE_SETTINGS };
    throw error;
  }
}

export async function writeResidentVoiceSettings(settings, filePath = DEFAULT_RESIDENT_VOICE_SETTINGS_PATH) {
  const validated = validateResidentVoiceSettings(settings);
  if (!validated) throw Object.assign(new Error('Resident voice settings are invalid.'), { code: 'VOICE_SETTINGS_INVALID' });
  const directory = path.dirname(filePath);
  const temporaryPath = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await import('node:fs/promises').then(({ unlink }) => unlink(temporaryPath).catch(() => {}));
    throw error;
  }
  return validated;
}
