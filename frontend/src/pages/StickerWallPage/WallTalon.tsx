import type { CSSProperties } from 'react';
import type { WallTicket } from './stickerWall';

/**
 * Талон «Доведе» для святкування `ticket` на стіні — порт `.dv-talon` із ролика-вступу /dovede
 * (DovedePage/intro/DovedeIntro.css), лише в em, щоб рости зі стіною. Хід (у такт зі звуком `ticket` у wallSound.ts):
 * талон виїжджає, на 0,95 с падає щелепа компостера, на 1,04 с — три дірки, на 1,27 с — штамп «щасливий».
 */
export function WallTalon({ ticket }: { ticket: WallTicket }) {
  return (
    <span className="wall-talon-wrap" aria-hidden="true">
      <span className="wall-talon-jaw" />
      <span className="wall-talon">
        <span className="wall-talon-body">
          <span className="wall-talon-brand">
            Доведе<span>.</span>
          </span>
          <span className="wall-talon-kind">Квиток на проїзд</span>
          <span className="wall-talon-route">Малин → куди скажете</span>
          <span className="wall-talon-no">Серія ДВ № {ticket.no}</span>
        </span>
        <span className="wall-talon-grid">
          {Array.from({ length: 9 }, (_, i) => {
            const order = ticket.holes.indexOf(i);
            return (
              <span key={i} className="wall-talon-cell">
                <span className="wall-talon-digit">{i + 1}</span>
                {order >= 0 ? <span className="wall-talon-hole" style={{ '--i': order } as CSSProperties} /> : null}
              </span>
            );
          })}
        </span>
        <span className="wall-talon-stamp">щасливий</span>
      </span>
    </span>
  );
}
