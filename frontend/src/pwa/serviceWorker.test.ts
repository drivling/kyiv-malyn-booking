import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  SW_SCOPE,
  SW_URL,
  applyNewBuild,
  applyReadyUpdate,
  checkForNewBuild,
  isTransportPath,
  registerTransportServiceWorker,
  resetServiceWorkerForTests,
  setUpdateReady,
  useUpdateReady,
  type ServiceWorkerLike,
} from './serviceWorker';

class FakeWorker extends EventTarget {
  state: ServiceWorkerState = 'installed';
  posted: unknown[] = [];
  constructor(public buildId = 'abc123') {
    super();
  }
  postMessage(message: unknown, transfer?: Transferable[]) {
    this.posted.push(message);
    const port = transfer?.[0] as MessagePort | undefined;
    if ((message as { type?: string })?.type === 'GET_BUILD_ID' && port) port.postMessage({ buildId: this.buildId });
  }
}

class FakeRegistration extends EventTarget {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  update = vi.fn(async () => undefined);
}

class FakeServiceWorkerContainer extends EventTarget implements ServiceWorkerLike {
  controller: ServiceWorker | null = null;
  reg = new FakeRegistration();
  register = vi.fn(async () => this.reg as unknown as ServiceWorkerRegistration);
  getRegistration = vi.fn(async () => this.reg as unknown as ServiceWorkerRegistration);
}

const worker = (id?: string) => new FakeWorker(id) as unknown as ServiceWorker & FakeWorker;

describe('serviceWorker (Docs/transport-pwa-2026-10.md, фаза 4)', () => {
  let sw: FakeServiceWorkerContainer;
  let reload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetServiceWorkerForTests();
    sw = new FakeServiceWorkerContainer();
    reload = vi.fn();
  });
  afterEach(() => resetServiceWorkerForTests());

  it('реєструє з scope /transport; перший install (controllerchange без нашого запиту) не перезавантажує', async () => {
    await registerTransportServiceWorker({ sw, reload });
    expect(sw.register).toHaveBeenCalledWith(SW_URL, { scope: SW_SCOPE });
    sw.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();
    expect(applyNewBuild()).toBe(false);
  });

  it('нова збірка вже чекає при реєстрації (інша вкладка) — банер, не reload', async () => {
    sw.controller = worker('old');
    sw.reg.waiting = worker('new1');
    const { result } = renderHook(() => useUpdateReady());
    await act(async () => {
      await registerTransportServiceWorker({ sw, reload });
    });
    expect(result.current).toBe('sw:new1');
    expect(reload).not.toHaveBeenCalled();
  });

  it('applyNewBuild шле SKIP_WAITING, reload — лише після controllerchange і лише раз', async () => {
    sw.controller = worker('old');
    const next = worker('new2');
    sw.reg.waiting = next;
    await registerTransportServiceWorker({ sw, reload });
    expect(applyNewBuild()).toBe(true);
    expect(next.posted).toContain('SKIP_WAITING');
    expect(reload).not.toHaveBeenCalled();
    sw.dispatchEvent(new Event('controllerchange'));
    sw.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('checkForNewBuild: reg.update(), потім sw:<id> з воркера, що чекає; без controller — перший install, null', async () => {
    await registerTransportServiceWorker({ sw, reload });
    sw.reg.waiting = worker('fresh');
    expect(await checkForNewBuild(100, sw)).toBeNull();
    sw.controller = worker('old');
    expect(await checkForNewBuild(100, sw)).toBe('sw:fresh');
    expect(sw.reg.update).toHaveBeenCalledTimes(2);
  });

  it('checkForNewBuild чекає, поки нова збірка докачає precache (installing → installed)', async () => {
    sw.controller = worker('old');
    await registerTransportServiceWorker({ sw, reload });
    const installing = worker('next');
    installing.state = 'installing';
    sw.reg.installing = installing;
    const pending = checkForNewBuild(5_000, sw);
    await Promise.resolve();
    installing.state = 'installed';
    sw.reg.installing = null;
    sw.reg.waiting = installing;
    installing.dispatchEvent(new Event('statechange'));
    expect(await pending).toBe('sw:next');
  });

  it('updatefound → installed за живою сторінкою → банер; без мережі reg.update() відхиляється → null', async () => {
    sw.controller = worker('old');
    await registerTransportServiceWorker({ sw, reload });
    const { result } = renderHook(() => useUpdateReady());
    const installing = worker('later');
    installing.state = 'installing';
    sw.reg.installing = installing;
    await act(async () => {
      sw.reg.dispatchEvent(new Event('updatefound'));
      installing.state = 'installed';
      sw.reg.waiting = installing;
      installing.dispatchEvent(new Event('statechange'));
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(result.current).toBe('sw:later');
    sw.reg.update.mockRejectedValueOnce(new Error('offline'));
    expect(await checkForNewBuild(100, sw)).toBeNull();
  });

  it('applyReadyUpdate: воркер — SKIP_WAITING, звичайна збірка — повне завантаження', async () => {
    sw.controller = worker('old');
    const next = worker('n');
    sw.reg.waiting = next;
    await registerTransportServiceWorker({ sw, reload });
    setUpdateReady('sw:n');
    const plainReload = vi.fn();
    applyReadyUpdate(plainReload);
    expect(next.posted).toContain('SKIP_WAITING');
    expect(plainReload).not.toHaveBeenCalled();
    setUpdateReady('/assets/index-NEW.js');
    applyReadyUpdate(plainReload);
    expect(plainReload).toHaveBeenCalledTimes(1);
  });

  it('isTransportPath: /transport і все під ним, але не /transportation-щось-інше', () => {
    expect(isTransportPath('/transport')).toBe(true);
    expect(isTransportPath('/transport/stop/st_0001')).toBe(true);
    expect(isTransportPath('/mizhgorodski')).toBe(false);
    expect(isTransportPath('/transportx')).toBe(false);
  });
});
