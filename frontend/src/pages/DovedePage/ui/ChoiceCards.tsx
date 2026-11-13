import { useEffect } from 'react';

export interface Choice {
  key: string;
  title: string;
  sub: string;
  time?: string;
  timeSub?: string;
}

/**
 * Одне уточнення — нумеровані картки, у яких уже є відповідь (Docs/dovede-roadmap.md, принцип 6).
 * Цифри 1–9 на клавіатурі працюють, коли курсор не в полі питання.
 */
export function ChoiceCards({ question, choices, hint, onChoose }: { question: string; choices: Choice[]; hint: string; onChoose: (key: string) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const i = Number(e.key) - 1;
      if (Number.isInteger(i) && i >= 0 && i < choices.length) {
        e.preventDefault();
        onChoose(choices[i].key);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [choices, onChoose]);

  return (
    <section className="dv-choices" aria-label={question}>
      <p className="dv-ask-q">{question}</p>
      {choices.map((c, i) => (
        <button key={c.key} type="button" className="dv-choice" onClick={() => onChoose(c.key)}>
          <span className="dv-choice__n" aria-hidden="true">{i + 1}</span>
          <span className="dv-choice__body">
            <span className="dv-choice__title">{c.title}</span>
            <span className="dv-choice__sub">{c.sub}</span>
          </span>
          {c.time ? (
            <span className="dv-choice__time">
              {c.time}
              {c.timeSub ? <small>{c.timeSub}</small> : null}
            </span>
          ) : null}
        </button>
      ))}
      <p className="dv-hint-keys">
        Натисніть {choices.map((_, i) => i + 1).join(', ')} або допишіть {hint}.
      </p>
    </section>
  );
}
