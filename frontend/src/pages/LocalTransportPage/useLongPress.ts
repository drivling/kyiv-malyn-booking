import { useCallback, useEffect, useRef } from 'react';
import type React from 'react';

export const LONG_PRESS_MS = 550;
const MOVE_TOLERANCE_PX = 10;

type LongPressHandlers = {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onClickCapture: (e: React.MouseEvent) => void;
};

/**
 * Довге натискання на елементі списку (чіп часу, картка табло): палець тримають ~0,5 с — або
 * правий клік / клавіша меню / системний long-press Android (`contextmenu`). Звичайний клік після
 * довгого натискання гаситься, щоб чіп не перемикав рейс, а картка не відкривала посилання.
 * Зсув пальця (прокрутка стрічки) скасовує натискання. Один стан на весь список — одночасно
 * натискають лише один елемент.
 */
export function useLongPress(): (onLongPress: () => void) => LongPressHandlers {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  /** Палець / кнопка зараз натиснуті — між pointerdown і pointerup */
  const pressing = useRef(false);

  const clear = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);

  useEffect(() => clear, [clear]);

  return useCallback(
    (onLongPress: () => void): LongPressHandlers => {
      const fire = () => {
        clear();
        fired.current = true;
        try {
          navigator.vibrate?.(15);
        } catch {
          /* не всі браузери */
        }
        onLongPress();
      };
      const release = () => {
        pressing.current = false;
        clear();
      };
      return {
        onPointerDown: (e) => {
          fired.current = false;
          pressing.current = true;
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          clear();
          start.current = { x: e.clientX, y: e.clientY };
          timer.current = window.setTimeout(fire, LONG_PRESS_MS);
        },
        onPointerMove: (e) => {
          const s = start.current;
          if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_TOLERANCE_PX) clear();
        },
        onPointerUp: release,
        onPointerLeave: release,
        onPointerCancel: release,
        onContextMenu: (e) => {
          e.preventDefault();
          // Android шле contextmenu на те саме утримання, що вже спрацювало за таймером
          if (fired.current && pressing.current) return;
          fire();
        },
        onClickCapture: (e) => {
          if (!fired.current) return;
          fired.current = false;
          e.preventDefault();
          e.stopPropagation();
        },
      };
    },
    [clear]
  );
}
