import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { ParseSpan } from '../nlu/types';
import { highlightParts } from './highlight';
import { applySuggestion, suggestPlaces, type PlaceSuggestion } from './suggest';
import { useVoiceInput } from '../voice/useVoiceInput';
import { VoiceButton } from './VoiceButton';

export interface QueryFieldHandle {
  focus(): void;
}

/**
 * Поле питання (Docs/dovede-roadmap.md, фаза 3): росте разом із текстом, підсвічує розпізнані слова
 * (звідки / куди / коли / чим) шаром під прозорим textarea і підказує місця для слова під курсором.
 */
export const QueryField = forwardRef<
  QueryFieldHandle,
  {
    value: string;
    spans: ParseSpan[];
    onChange: (text: string) => void;
    onSubmit: () => void;
    /** мікрофон: є — кнопка показується (усім, кому відкрито сторінку, де є Web Speech); `final` — браузер визнав фразу остаточною, можна шукати */
    onVoice?: (text: string, final: boolean) => void;
    /** натиснули мікрофон — сторінка водночас питає місце людини (Docs/dovede-geo-roadmap.md, Г2) */
    onVoiceStart?: () => void;
  }
>(
  function QueryField({ value, spans, onChange, onSubmit, onVoice, onVoiceStart }, ref) {
    const input = useRef<HTMLTextAreaElement>(null);
    const mirror = useRef<HTMLDivElement>(null);
    const [caret, setCaret] = useState(0);
    const [focused, setFocused] = useState(false);
    const [active, setActive] = useState(0);
    // Підказки сховано до наступної літери: після «Знайти», Esc чи вибору. Інакше вони зникали б у мить кліку
    // по відповіді (поле втрачає фокус), сторінка зсувалась, і клік не влучав.
    const [closed, setClosed] = useState(false);
    const nextCaret = useRef<number | null>(null);

    useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), []);
    const voice = useVoiceInput((text, final) => {
      setClosed(true);
      onVoice?.(text, final);
    });

    // Поле росте разом із питанням (до 40% екрана)
    useEffect(() => {
      const el = input.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight + 2}px`;
      if (nextCaret.current != null) {
        el.setSelectionRange(nextCaret.current, nextCaret.current);
        nextCaret.current = null;
      }
    }, [value]);

    const suggestions = useMemo(() => (focused && !closed ? suggestPlaces(value, caret) : []), [focused, closed, value, caret]);
    useEffect(() => setActive(0), [suggestions.length]);

    const pick = (s: PlaceSuggestion) => {
      const next = applySuggestion(value, s);
      nextCaret.current = next.caret;
      setCaret(next.caret);
      setClosed(true);
      onChange(next.text);
      input.current?.focus();
    };

    const parts = useMemo(() => highlightParts(value, spans), [value, spans]);
    const listId = 'dv-suggest';

    return (
      <div className="dv-ask__field">
        <div className="dv-field">
          <div className="dv-input">
            <div className="dv-mirror" ref={mirror} aria-hidden="true">
              {parts.map((p, i) => (p.kind ? <mark key={i} className={`dv-hl dv-hl--${p.kind}`}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
              {/* останній перенос рядка textarea показує, div — ні */}
              {value.endsWith('\n') ? ' ' : null}
            </div>
            <textarea
              id="dv-q"
              ref={input}
              rows={1}
              value={value}
              placeholder="Звідки й куди їдете?"
              enterKeyHint="search"
              spellCheck={false}
              autoComplete="off"
              role="combobox"
              aria-expanded={suggestions.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={suggestions.length ? `${listId}-${active}` : undefined}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onChange={(e) => {
                setCaret(e.target.selectionStart ?? e.target.value.length);
                setClosed(false);
                onChange(e.target.value);
              }}
              onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
              onScroll={(e) => {
                if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop;
              }}
              onKeyDown={(e) => {
                if (suggestions.length) {
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
                    return;
                  }
                  if (e.key === 'Tab' && !e.shiftKey) {
                    e.preventDefault();
                    pick(suggestions[active]);
                    return;
                  }
                  if (e.key === 'Escape') {
                    setClosed(true);
                    return;
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  setClosed(true);
                  onSubmit();
                }
              }}
            />
          </div>
          {onVoice ? (
            <VoiceButton
              state={voice.state}
              onClick={() => {
                if (voice.state === 'idle') onVoiceStart?.();
                voice.toggle();
              }}
            />
          ) : null}
          <button className="dv-go" type="submit" onClick={() => setClosed(true)}>
            Знайти
          </button>
        </div>
        {onVoice ? (
          <p className="dv-voice-hint" role="status">
            {voice.state === 'starting' ? 'Вмикаю мікрофон…' : voice.state === 'listening' ? 'Говоріть — питайте як у розмові' : (voice.error ?? '')}
          </p>
        ) : null}
        <div className="dv-suggest-list" id={listId} role="listbox" aria-label="Підказки місць">
          {suggestions.map((s, i) => (
            <button
              key={s.place.id}
              id={`${listId}-${i}`}
              type="button"
              role="option"
              aria-selected={i === active}
              className={`dv-suggest-item${i === active ? ' is-active' : ''}`}
              // mousedown, а не click: поле не має втратити фокус раніше, ніж підставимо слово
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
            >
              {s.label}
            </button>
          ))}
          {suggestions.length ? <span className="dv-suggest-hint">Tab — підставити</span> : null}
        </div>
      </div>
    );
  },
);
