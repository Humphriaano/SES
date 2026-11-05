import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, TextareaHTMLAttributes } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAutocompleteSettings, vocabularyFor } from '../../lib/autocompleteSettings';
import { getLearned, recordLearned } from '../../lib/clinicalLearning';
import { doNotUseWarning, formatExpansion, suggest } from '../../lib/clinicalAutocomplete';

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'style'> & { value: string; style: CSSProperties };

// A textarea that offers abbreviation expansions as faint text after the cursor.
// Tab accepts, Esc or simply typing on ignores. Accepting inserts ordinary text
// exactly as if it had been typed, so what is saved never changes.
const SuggestTextarea = forwardRef<HTMLTextAreaElement, Props>(function SuggestTextarea({ value, style, readOnly, onChange, onSelect, onBlur, onKeyDown, ...rest }, forwarded) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const marker = useRef<HTMLSpanElement>(null);
  const settings = useAutocompleteSettings();
  const userId = useAuth().user?.id;
  const vocabulary = useMemo(() => vocabularyFor(settings), [settings]);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [dismissed, setDismissed] = useState('');
  const [active, setActive] = useState(0);
  const [popover, setPopover] = useState<{ top: number; left: number } | null>(null);
  const live = !readOnly && selection !== null;

  const suggestion = useMemo(() => live ? suggest(value, selection!.start, selection!.end, vocabulary, getLearned(userId)) : null, [live, value, selection, vocabulary, userId]);
  const suggestionKey = suggestion ? `${suggestion.abbr}@${suggestion.start}:${value.length}` : '';
  const shown = suggestion && suggestionKey !== dismissed ? suggestion : null;
  const warning = useMemo(() => live && !shown ? doNotUseWarning(value, selection!.start, selection!.end, vocabulary) : null, [live, shown, value, selection, vocabulary]);
  const multiple = (shown?.options.length ?? 0) > 1;

  useEffect(() => { setActive(0); }, [suggestionKey]);
  useLayoutEffect(() => {
    if (shown && multiple && marker.current) setPopover({ top: marker.current.offsetTop + marker.current.offsetHeight, left: marker.current.offsetLeft });
    else setPopover(null);
  }, [shown, multiple, value]);

  const setRef = useCallback((node: HTMLTextAreaElement | null) => {
    inner.current = node;
    if (typeof forwarded === 'function') forwarded(node); else if (forwarded) forwarded.current = node;
  }, [forwarded]);

  function remember(el: HTMLTextAreaElement) { setSelection({ start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 }); }

  function accept(option: string) {
    const el = inner.current;
    if (!el || !shown) return;
    // A phrase only continues what was typed; an abbreviation is replaced by its meaning.
    const text = shown.phrase ? option : formatExpansion(value, shown.start, option);
    recordLearned(userId, shown, option);
    el.focus();
    el.setSelectionRange(shown.start, shown.end);
    // insertText keeps the browser's undo history working (Ctrl+Z restores the abbreviation).
    const done = typeof document.execCommand === 'function' && document.execCommand('insertText', false, text);
    if (!done) { el.setRangeText(text, shown.start, shown.end, 'end'); el.dispatchEvent(new Event('input', { bubbles: true })); }
  }

  function handleKey(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented || !shown || event.nativeEvent.isComposing) return;
    const plain = !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
    if (event.key === 'Tab' && plain) { event.preventDefault(); accept(shown.options[active]); }
    else if (event.key === 'Escape') { event.preventDefault(); setDismissed(suggestionKey); }
    else if (multiple && plain && event.key === 'ArrowDown') { event.preventDefault(); setActive(i => (i + 1) % shown.options.length); }
    else if (multiple && plain && event.key === 'ArrowUp') { event.preventDefault(); setActive(i => (i + shown.options.length - 1) % shown.options.length); }
  }

  const preview = settings.preview;
  const mirror: CSSProperties = { ...style, position: 'absolute', inset: 0, height: 'auto', minHeight: 0, pointerEvents: 'none', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: 'normal', color: 'transparent', overflow: 'hidden' };
  const ghost = shown && (shown.phrase ? shown.options[0] : multiple ? `→ ${shown.options.length} meanings` : `→ ${formatExpansion(value, shown.start, shown.options[0])}`);

  return (
    <div style={{ position: 'relative' }}>
      <textarea
        {...rest}
        // The browser's own spelling popup would take the Tab key, so it is off while a suggestion is shown.
        spellCheck={shown || warning ? false : rest.spellCheck}
        ref={setRef}
        value={value}
        readOnly={readOnly}
        style={style}
        onChange={event => { remember(event.target); setDismissed(''); onChange?.(event); }}
        onSelect={event => { remember(event.currentTarget); onSelect?.(event); }}
        onBlur={event => { setSelection(null); onBlur?.(event); }}
        onKeyDown={handleKey}
      />
      {shown && <div aria-hidden="true" style={mirror}>
        <span>{value.slice(0, shown.end)}</span>
        <span ref={marker} style={shown.phrase ? { color: 'var(--text-subtle)' } : { color: 'var(--text-subtle)', fontSize: '0.86em', paddingLeft: 6 }}>{ghost}{!multiple && <span style={{ border: '1px solid var(--border)', borderRadius: 4, marginLeft: 6, padding: '0 4px', fontSize: '0.8em' }}>Tab</span>}</span>
      </div>}
      {shown && multiple && popover && <ul role="listbox" aria-label={`Meanings of ${shown.abbr}`}
        style={{ position: 'absolute', top: popover.top + 2, left: Math.min(popover.left, 120), zIndex: 20, margin: 0, padding: 4, listStyle: 'none', minWidth: 220, maxWidth: 'min(420px, 90%)', background: 'var(--bg-card)', border: '1px solid var(--border-input)', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,.12)', fontSize: 13 }}>
        {shown.options.map((option, index) => <li key={option} role="option" aria-selected={index === active}
          onMouseDown={event => { event.preventDefault(); accept(option); }}
          style={{ padding: '6px 10px', borderRadius: 8, cursor: 'pointer', color: 'var(--text-heading)', background: index === active ? 'var(--ws-chip)' : 'transparent' }}>
          {option}{index === active && <span style={{ float: 'right', marginLeft: 12, fontSize: 11, color: 'var(--text-muted)' }}>Tab</span>}
        </li>)}
      </ul>}
      <span role="status" aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {shown ? (shown.phrase ? `Press Tab to complete the ${shown.word ? 'word' : 'phrase'}: ${shown.abbr}${shown.options[0]}.` : multiple ? `${shown.abbr} has ${shown.options.length} meanings. Press Tab to choose ${shown.options[active]}.` : `Press Tab to expand ${shown.abbr} to ${shown.options[0]}.`) : ''}
      </span>
      {warning && <div role="status" style={{ fontSize: 11, color: 'var(--badge-amber-text)', marginTop: 2 }}>Avoid “{warning.written.replace(/\s*\(.*\)/, '').split(',')[0].split(' or ')[0]}”: {warning.risk.charAt(0).toLowerCase() + warning.risk.slice(1)}. {/^write/i.test(warning.writeInstead) ? warning.writeInstead : `Write ${warning.writeInstead}`}.</div>}
      {preview && (shown || warning) && <div style={{ fontSize: 10, color: 'var(--text-subtle)' }}>Preview of the draft list, not yet reviewed.</div>}
    </div>
  );
});

export default SuggestTextarea;
