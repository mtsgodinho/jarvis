// Deliberate allowlist, case-insensitive for Windows. In particular excludes
// provider credentials, JARVIS_*, NODE_OPTIONS, preload hooks and proxy secrets.
const systemNames = new Set([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'SYSTEMDRIVE',
  'TEMP', 'TMP', 'TMPDIR', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'HOME',
  'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)',
  'PROGRAMW6432', 'COMMONPROGRAMFILES', 'COMMONPROGRAMFILES(X86)',
  'COMMONPROGRAMW6432', 'USERNAME', 'USERDOMAIN', 'COMPUTERNAME',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER',
  'OS', 'LANG', 'LC_ALL', 'TZ',
]);
const backendNames = new Set([
  'PORT', 'GOOGLE_API_KEY', 'GOOGLE_MODEL', 'GEMINI_TIMEOUT_MS',
  'OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_ENABLED', 'OPENAI_TIMEOUT_MS',
  'OPENROUTER_API_KEY', 'OPENROUTER_MODEL', 'OPENROUTER_TIMEOUT_MS',
]);

export function processEnvironment(env = process.env, { backend = false } = {}) {
  const clean = {};
  const seen = new Set();
  for (const [name, value] of Object.entries(env)) {
    const canonical = name.toUpperCase();
    if (typeof value !== 'string' || seen.has(canonical)) continue;
    if (!systemNames.has(canonical) && !(backend && backendNames.has(canonical))) continue;
    clean[name] = value;
    seen.add(canonical);
  }
  return clean;
}
