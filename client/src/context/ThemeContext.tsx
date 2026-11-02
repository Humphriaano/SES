import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

export type Theme = 'light' | 'charcoal' | 'blue';

interface ThemeContextValue {
  theme: Theme;
  isDark: boolean;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light', isDark: false, setTheme: () => {}, toggle: () => {},
});

const ORDER: Theme[] = ['light', 'charcoal', 'blue'];

function load(): Theme {
  try {
    const t = localStorage.getItem('ses-theme');
    if (t === 'light' || t === 'charcoal' || t === 'blue') return t;
    if (t === 'dark') return 'charcoal'; // legacy value
  } catch { /* ignore */ }
  return 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(load);
  const isDark = theme !== 'light';

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', isDark ? 'dark' : 'light');
    root.setAttribute('data-skin', theme);
    try { localStorage.setItem('ses-theme', theme); } catch { /* ignore */ }
  }, [theme, isDark]);

  const toggle = () => setTheme((t) => ORDER[(ORDER.indexOf(t) + 1) % ORDER.length]);

  return (
    <ThemeContext.Provider value={{ theme, isDark, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
