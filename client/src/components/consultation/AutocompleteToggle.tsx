import { setAutocompleteEnabled, useAutocompleteSettings } from '../../lib/autocompleteSettings';

// Per-user switch for note suggestions (this browser only).
export default function AutocompleteToggle() {
  const { enabled } = useAutocompleteSettings();
  return (
    <button type="button" role="switch" aria-checked={enabled} onClick={() => setAutocompleteEnabled(!enabled)}
      title={enabled ? 'Turn off abbreviation suggestions in notes' : 'Turn on abbreviation suggestions in notes'}
      style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 999, padding: '3px 10px', fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
      Suggestions: {enabled ? 'on' : 'off'}
    </button>
  );
}
