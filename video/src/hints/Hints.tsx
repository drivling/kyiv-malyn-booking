import type React from 'react';
import { AbsoluteFill, Audio, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { type MusicEditName, musicEditFile } from '../audio/music';
import { type SfxCue, SfxCues } from '../audio/Sfx';
import { beats } from '../brand/beat';
import { GOLOS } from '../brand/fonts';
import { SafeZones } from '../brand/SafeZones';
import { COLORS, HEIGHT, SAFE_STORY, WIDTH } from '../brand/tokens';
import { Dot } from './Dot';
import { Talon } from './Talon';

/**
 * Сторіс-натяки перед запуском (Docs/dovede-teaser/roadmap.md, «Сторіс-натяки»): три короткі ролики 9:16 для сторіс
 * Facebook / Instagram. Ні посилання, ні назви сервісу — лише підпис серії (крапка падає, тричі підскакує, гасне з
 * «дзинь», як у фіналі реклами) і шматки того самого треку (`audio/music.json`, монтажі hint1–3), щоб рекламу потім
 * упізнали. Текст і крапка — у безпечній зоні сторіс (`SAFE_STORY`: зверху 14 %, знизу 20 %).
 */
export type HintProps = { showSafe: boolean; sound?: boolean };
export type TicketHintProps = HintProps & { date?: string };

/** Тривалість у бітах треку */
export const HINT_BEATS = { hint1: 16, hint2: 24, hint3: 25 } as const;
export const hintFrames = (name: keyof typeof HINT_BEATS) => beats(HINT_BEATS[name]);

/** Центр безпечної зони сторіс по вертикалі */
const MID_Y = ((SAFE_STORY.top + 1 - SAFE_STORY.bottom) / 2) * HEIGHT;

const Story: React.FC<HintProps & { music: MusicEditName; cues: SfxCue[]; children: React.ReactNode }> = ({ showSafe, sound = true, music, cues, children }) => (
  <AbsoluteFill style={{ background: COLORS.paper }}>
    {children}
    {sound ? <Audio src={staticFile(musicEditFile(music))} volume={0.85} /> : null}
    {sound ? <SfxCues cues={cues} /> : null}
    {showSafe ? <SafeZones zones={SAFE_STORY} /> : null}
  </AbsoluteFill>
);

/** Чотири удари крапки (падіння й три підскоки) — «тук», щоразу тихіше */
const bounceCues = (impact: number): SfxCue[] => [0, 1, 2, 3].map((i) => ({ name: 'tup', at: beats(impact + i), volume: 0.45 - i * 0.08 }));

/**
 * 1 «Крапка» (16 бітів ≈ 7,7 с). Білий екран і глухий вступ треку; маленька крапка дихає на кожен біт. За біт до дропу
 * злітає, на дропі падає й тричі підскакує, далі пульсує «ви тут»; на стоп-паузі треку гасне з «дзинь». Без тексту.
 */
export const Hint1: React.FC<HintProps> = (props) => (
  <Story
    {...props}
    music="hint1"
    cues={[{ name: 'whoosh', at: beats(6.5), volume: 0.25 }, ...bounceCues(8), { name: 'ting', at: beats(15), volume: 0.5 }]}
  >
    <Dot cx={WIDTH / 2} cy={MID_Y} size={92} em={260} plan={{ appear: 0.25, small: 0.55, breatheUntil: 6.5, rise: [6.5, 7.5], fall: 7.5, pulse: [[11, 15]], out: 15 }} />
  </Story>
);

const WORDS = ['Язик', 'до', 'Києва'];
const WORD_BEATS = [4, 5.5, 7];

/**
 * 2 «Язик до Києва…» (24 біти ≈ 11,5 с). На біт встають «Язик», «до», «Києва»; на місці четвертого слова блимає
 * курсор. На дропі замість слова падає лише крапка — тричі підскакує й пульсує; нижче «Чого не вистачає?». Людина сама
 * договорює прислівʼя («…доведе»), а реклама потім відповідає. На стоп-паузі крапка гасне, слова тануть.
 */
export const Hint2: React.FC<HintProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = (b: number) => (frame < beats(b) ? 0 : spring({ frame: frame - beats(b), fps, config: { damping: 13, mass: 0.45, stiffness: 240 } }));
  const fadeAll = interpolate(frame, [beats(23), beats(23.6)], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const caretOn = frame >= beats(8) && frame < beats(12) && Math.floor((frame - beats(8)) / beats(0.5)) % 2 === 0;
  const ask = pop(16);
  const lineY = MID_Y - 120;
  const slotY = MID_Y + 90;
  return (
    <Story
      {...props}
      music="hint2"
      cues={[
        ...WORD_BEATS.map((b) => ({ name: 'hit' as const, at: beats(b), volume: 0.42 })),
        ...[8, 9, 10, 11].map((b) => ({ name: 'tick' as const, at: beats(b), volume: 0.12 })),
        { name: 'whoosh', at: beats(11.5), volume: 0.25 },
        ...bounceCues(12),
        { name: 'ting', at: beats(23), volume: 0.5 },
      ]}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: lineY,
          transform: 'translateY(-50%)',
          textAlign: 'center',
          fontFamily: GOLOS,
          fontWeight: 800,
          fontSize: 118,
          lineHeight: 1,
          letterSpacing: '-0.02em',
          color: COLORS.ink,
          whiteSpace: 'nowrap',
          opacity: fadeAll,
        }}
      >
        {WORDS.map((w, i) => {
          const k = pop(WORD_BEATS[i]);
          return (
            <span
              key={w}
              style={{
                display: 'inline-block',
                margin: '0 0.12em',
                opacity: Math.min(1, k * 1.6),
                transform: `scale(${1.4 - 0.4 * k}) translateY(${(1 - Math.min(1, k)) * 0.18}em)`,
                filter: `blur(${Math.max(0, 1 - k) * 8}px)`,
              }}
            >
              {w}
            </span>
          );
        })}
      </div>
      {caretOn ? <div style={{ position: 'absolute', left: WIDTH / 2 - 6, top: slotY - 70, width: 12, height: 140, borderRadius: 3, background: COLORS.ink }} /> : null}
      <Dot cx={WIDTH / 2} cy={slotY} size={70} em={260} plan={{ appear: 11.5, fall: 11.5, pulse: [[15, 23]], out: 23 }} />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: MID_Y + 300,
          textAlign: 'center',
          fontFamily: GOLOS,
          fontWeight: 700,
          fontSize: 54,
          color: COLORS.muted,
          opacity: Math.min(1, ask) * fadeAll,
          transform: `translateY(${(1 - Math.min(1, ask)) * 24}px)`,
        }}
      >
        Чого не вистачає?
      </div>
    </Story>
  );
};

const TALON_SCALE = 2.5;
/** Щасливий номер: 0 + 4 + 2 = 0 + 1 + 5 */
const TALON_NO = '042 015';
/** Перша дірка (клітинка «6», праворуч посередині) — звідти крапка серії */
const TALON_HOLES = [5, 0, 7];

/**
 * 3 «Квиток» (25 бітів ≈ 12 с). Виїжджає талон — як на сайті після реклами, але без назви («Куди скажете.»). На дропі —
 * щелепа компостера,
 * клац, три дірки; на наступну долю штамп «щасливий»; на стоп-паузі друкується «Дійсний з …» (`date`, без неї —
 * «Дійсний: скоро»). Під фінальну фразу перша дірка стає блакитною крапкою, пульсує, тоді вистрибує, тричі підскакує
 * й на останньому ударі треку гасне з «дзинь». На останню долю талон тане — кадр знову білий.
 */
export const Hint3: React.FC<TicketHintProps> = ({ date, ...props }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const slide = spring({ frame, fps, config: { damping: 16, stiffness: 90, mass: 0.9 } });
  const fade = interpolate(frame, [beats(24), beats(24.8)], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const validText = date ? `Дійсний з ${date}` : 'Дійсний: скоро';
  const typingFrames = beats(1);
  return (
    <Story
      {...props}
      music="hint3"
      cues={[
        { name: 'whoosh', at: 4, volume: 0.22 },
        { name: 'clack', at: beats(4), volume: 0.8 },
        { name: 'thud', at: beats(5), volume: 0.6 },
        ...Array.from({ length: Math.min(12, validText.length) }, (_, i) => ({ name: (['key0', 'key1', 'key2'] as const)[i % 3], at: beats(7) + (i * typingFrames) / 12, volume: 0.15 })),
        { name: 'pop', at: beats(8), volume: 0.4 },
        { name: 'whoosh', at: beats(15.5), volume: 0.2 },
        ...bounceCues(16),
        { name: 'ting', at: beats(24), volume: 0.5 },
      ]}
    >
      <div
        style={{
          position: 'absolute',
          left: WIDTH / 2,
          top: MID_Y,
          opacity: fade,
          transform: `translate(-50%, -50%) translateY(${(1 - slide) * 900}px) rotate(${(1 - slide) * 6}deg) scale(${TALON_SCALE})`,
        }}
      >
        <Talon
          no={TALON_NO}
          validText={validText}
          holes={TALON_HOLES}
          times={{ punch: beats(4), stamp: beats(5), valid: beats(7), validFrames: typingFrames, beat: beats(1) }}
          inHole={
            <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }}>
              <Dot cx={12} cy={12} size={20} em={56} plan={{ appear: 8, pulse: [[8.5, 15.5], [19, 24]], fall: 15.5, out: 24 }} />
            </div>
          }
        />
      </div>
    </Story>
  );
};
