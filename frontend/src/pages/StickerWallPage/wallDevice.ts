/**
 * Телефон на стіні: екран не гасне (Screen Wake Lock), сторінка на весь екран і в горизонтальному
 * положенні, де браузер це дозволяє (Android Chrome — так; iOS Safari — лише wake lock).
 * Усе з дотику «Почати»; будь-яка відмова браузера не ламає віджет.
 */
type WakeLockSentinelLike = { release: () => Promise<void>; addEventListener?: (t: 'release', cb: () => void) => void };
type WakeLockLike = { request: (type: 'screen') => Promise<WakeLockSentinelLike> };

/**
 * Тримає екран увімкненим, поки сторінка видима; браузер знімає блокування, коли вкладку сховали,
 * тож при поверненні просимо знову. `onChange(true|false)` — для індикатора у віджеті.
 */
export function keepScreenAwake(onChange: (active: boolean) => void): () => void {
  const wakeLock = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
  if (!wakeLock) {
    onChange(false);
    return () => {};
  }
  let sentinel: WakeLockSentinelLike | null = null;
  let stopped = false;
  const request = async () => {
    if (stopped || document.visibilityState !== 'visible') return;
    try {
      sentinel = await wakeLock.request('screen');
      onChange(true);
      sentinel.addEventListener?.('release', () => onChange(false));
    } catch {
      onChange(false);
    }
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') void request();
  };
  document.addEventListener('visibilitychange', onVisible);
  void request();
  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', onVisible);
    void sentinel?.release().catch(() => {});
  };
}

/** На весь екран і горизонтально — лише з дотику; помилки (iOS, десктоп) мовчки ігноруємо */
export async function enterWallFullscreen(): Promise<void> {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
  try {
    if (!document.fullscreenElement) {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
      else await el.webkitRequestFullscreen?.();
    }
  } catch {
    /* без повного екрана віджет теж працює */
  }
  try {
    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await orientation?.lock?.('landscape');
  } catch {
    /* браузер не дає блокувати орієнтацію — поверне користувач */
  }
}
