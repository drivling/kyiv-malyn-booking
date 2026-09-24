/**
 * Таймінг HTTP-запитів: заголовок `X-Response-Time` + один рядок у лог на запит.
 *
 * Потрібен, щоб вимірювати ефект фаз плану `Docs/poputky-search-performance-plan.md`
 * без Railway UI. Без зовнішніх залежностей. `/health` не логуємо (шум від моніторингу).
 * Вимкнути лог: HTTP_TIMING_LOG=0 (заголовок лишається). У vitest лог вимкнено за замовчуванням.
 */
import type { NextFunction, Request, Response } from 'express';

const SKIP_LOG_PATHS = new Set(['/health']);

export function requestTiming(opts: { log?: boolean } = {}) {
  const log = opts.log ?? (process.env.HTTP_TIMING_LOG !== '0' && !process.env.VITEST);
  return (req: Request, res: Response, next: NextFunction): void => {
    const startedAt = process.hrtime.bigint();
    let headerSet = false;
    const setHeader = (): void => {
      if (headerSet || res.headersSent) return;
      headerSet = true;
      const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
      res.setHeader('X-Response-Time', `${ms.toFixed(1)}ms`);
    };
    // Виставляємо заголовок перед першим записом у відповідь (writeHead викликається і з json()).
    const origWriteHead = res.writeHead.bind(res) as typeof res.writeHead;
    res.writeHead = ((...args: Parameters<typeof res.writeHead>) => {
      setHeader();
      return origWriteHead(...args);
    }) as typeof res.writeHead;

    if (log) {
      res.on('finish', () => {
        const path = req.originalUrl.split('?')[0];
        if (SKIP_LOG_PATHS.has(path)) return;
        const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
        console.log(`[http] ${req.method} ${path} ${res.statusCode} ${ms.toFixed(0)}ms`);
      });
    }
    next();
  };
}
