const STORAGE_KEY = 'gwas-prepubmatch-theme';

export const THEMES = {
  dark: 'dark',
  light: 'light',
};

export function getStoredTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === THEMES.light || stored === THEMES.dark) return stored;
  } catch {
    /* ignore */
  }
  return THEMES.dark;
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
}

export function initTheme() {
  applyTheme(getStoredTheme());
}
