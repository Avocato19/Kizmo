export type Theme = 'light' | 'dark';

const KEY = 'kizmo-theme';

export const getStoredTheme = (): Theme | null => {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'dark' || value === 'light' ? value : null;
  } catch { return null; }
};

export const systemTheme = (): Theme =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

export const currentTheme = (): Theme => {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark' || attr === 'light') return attr;
  return getStoredTheme() ?? systemTheme();
};

export const applyTheme = (theme: Theme, persist = true) => {
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#17131a' : '#fff8fb');
  if (persist) { try { localStorage.setItem(KEY, theme); } catch { /* storage unavailable */ } }
};
