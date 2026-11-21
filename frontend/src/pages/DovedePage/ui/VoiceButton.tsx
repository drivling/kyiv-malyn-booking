import type { VoiceState } from '../voice/useVoiceInput';

const LABEL: Record<VoiceState, string> = {
  idle: 'Сказати голосом',
  starting: 'Вмикаю мікрофон…',
  listening: 'Слухаю — натисніть, щоб зупинити',
};

/** Кнопка мікрофона біля поля питання (Docs/dovede-voice-roadmap.md, Ф1·2): лише для адміна, Web Speech */
export function VoiceButton({ state, onClick }: { state: VoiceState; onClick: () => void }) {
  return (
    <button type="button" className={`dv-mic dv-mic--${state}`} aria-pressed={state !== 'idle'} aria-label={LABEL[state]} title={LABEL[state]} onClick={onClick}>
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
        <rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </button>
  );
}
