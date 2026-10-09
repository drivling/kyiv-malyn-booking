import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCachedLoader } from './catalogCache';

describe('createCachedLoader', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('робить один запит на паралельні get() і віддає кеш до TTL', async () => {
    const load = vi.fn(async () => [1, 2, 3]);
    const loader = createCachedLoader(load, 1000);
    const [a, b] = await Promise.all([loader.get(), loader.get()]);
    expect(a).toBe(b);
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    await loader.get();
    expect(load).toHaveBeenCalledTimes(1);
    expect(loader.peek()).toEqual([1, 2, 3]);
  });

  it('перечитує після TTL і після invalidate()', async () => {
    const load = vi.fn(async () => ({ n: Math.random() }));
    const loader = createCachedLoader(load, 1000);
    await loader.get();
    vi.advanceTimersByTime(1001);
    expect(loader.peek()).toBeNull();
    await loader.get();
    expect(load).toHaveBeenCalledTimes(2);
    loader.invalidate();
    await loader.get();
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('не кешує помилку — наступний get() пробує знову', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok');
    const loader = createCachedLoader<string>(load, 1000);
    await expect(loader.get()).rejects.toThrow('boom');
    await expect(loader.get()).resolves.toBe('ok');
    expect(load).toHaveBeenCalledTimes(2);
  });
});
