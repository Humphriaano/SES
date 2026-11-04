import { useTheme, Theme } from '../context/ThemeContext';

const THEMES: { id: Theme; label: string; swatch: string }[] = [
  { id: 'light', label: 'Light', swatch: '#FFFFFF' },
  { id: 'charcoal', label: 'Noir', swatch: '#181B1E' },
  { id: 'blue', label: 'Blue', swatch: '#1F5F96' },
];

export default function ThemeSwatches({ size = 20 }: { size?: number }) {
  const { theme, setTheme } = useTheme();
  return (
    <div role="group" aria-label="Colour mode" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          title={`${t.label} mode`}
          aria-label={`${t.label} mode`}
          aria-pressed={theme === t.id}
          onClick={() => setTheme(t.id)}
          style={{
            width: size, height: size, borderRadius: '50%', padding: 0, cursor: 'pointer',
            background: t.swatch, border: '2px solid transparent',
            outline: theme === t.id ? '2px solid var(--ring)' : '1px solid rgba(128,128,128,.45)',
            outlineOffset: theme === t.id ? 1 : 0,
          }}
        />
      ))}
    </div>
  );
}
