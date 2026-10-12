/**
 * Фонова задача в процесі бекенду замість зовнішнього cron-job.org.
 * Наступний тік не стартує, поки попередній не завершився; помилка тіка лише логується.
 */
export interface IntervalJob {
  stop(): void;
}

export function startIntervalJob(
  name: string,
  run: () => Promise<void>,
  opts: { intervalMin: number; firstDelayMs?: number; log?: (m: string) => void; note?: string },
): IntervalJob | null {
  const { intervalMin } = opts;
  if (!Number.isFinite(intervalMin) || intervalMin <= 0) return null; // 0 = вимкнено
  const log = opts.log ?? ((m: string) => console.log(m));
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await run();
    } catch (e) {
      log(`[${name}] tick error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMin * 60_000);
  timer.unref();
  const first = setTimeout(() => void tick(), opts.firstDelayMs ?? 60_000);
  first.unref();
  log(`[${name}] scheduler started (every ${intervalMin} min${opts.note ? `, ${opts.note}` : ''})`);
  return {
    stop(): void {
      clearInterval(timer);
      clearTimeout(first);
    },
  };
}
