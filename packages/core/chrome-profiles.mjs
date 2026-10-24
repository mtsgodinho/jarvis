export const CHROME_PROFILES = Object.freeze([
  Object.freeze({ name: 'Mateus', directory: 'Default' }),
  Object.freeze({ name: 'Mathias', directory: 'Profile 1' }),
  Object.freeze({ name: 'amanda', directory: 'Profile 2' }),
  Object.freeze({ name: 'Lopes', directory: 'Profile 4' }),
  Object.freeze({ name: 'Bromélias', directory: 'Profile 5' }),
  Object.freeze({ name: 'toque', directory: 'Profile 6' }),
]);

export function findChromeProfile(name) {
  const normalized = normalizeProfileName(name);
  return CHROME_PROFILES.find(profile => normalizeProfileName(profile.name) === normalized) ?? null;
}

function normalizeProfileName(name) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}