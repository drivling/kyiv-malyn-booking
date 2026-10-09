/**
 * Вкладка «Джура»: список чатів і статус слухача, прапорці «Читати»/«В Обране», backfill із
 * прогресом задачі, експорт JSON (Blob + ім'я файлу з Content-Disposition), помилки.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import type { DzhuraChatRow, DzhuraJob, DzhuraMessageRow, DzhuraStatus } from '@/types';
import { DzhuraTab } from './DzhuraTab';

const API = `${TEST_API_URL}/admin/dzhura`;

const lunchChat: DzhuraChatRow = {
  id: 1,
  tgChatId: '-5427750954',
  kind: 'group',
  title: 'Обіди',
  username: null,
  membersCount: 12,
  isLunchGroup: true,
  captureEnabled: true,
  relayToSaved: false,
  lastMessageAt: '2026-09-25T09:00:00.000Z',
  lastCapturedAt: '2026-09-25T09:00:01.000Z',
  dialogSyncedAt: '2026-09-25T08:00:00.000Z',
  messagesCount: 40,
};

const adminChat: DzhuraChatRow = {
  id: 2,
  tgChatId: '-1001234567890',
  kind: 'supergroup',
  title: 'Admin',
  username: null,
  membersCount: 3,
  isLunchGroup: false,
  captureEnabled: true,
  relayToSaved: false,
  lastMessageAt: '2026-09-24T18:30:00.000Z',
  lastCapturedAt: null,
  dialogSyncedAt: null,
  messagesCount: 0,
};

const idleChat: DzhuraChatRow = {
  ...adminChat,
  id: 3,
  tgChatId: '-777',
  kind: 'group',
  title: 'Друга група',
  captureEnabled: false,
  membersCount: null,
};

const privateChat: DzhuraChatRow = {
  ...idleChat,
  id: 4,
  tgChatId: '438100',
  kind: 'private',
  title: 'Костя Іванов',
  username: 'kostya',
  membersCount: null,
  captureEnabled: false,
  relayToSaved: false,
};

const privateCaptured: DzhuraChatRow = {
  ...privateChat,
  id: 5,
  tgChatId: '438101',
  title: 'Оля Петренко',
  username: null,
  captureEnabled: true,
  relayToSaved: true,
  messagesCount: 12,
};

const freshStatus: DzhuraStatus = {
  listenerWanted: true,
  heartbeatAt: new Date(Date.now() - 4_000).toISOString(),
  heartbeatFresh: true,
  dialogsSyncedAt: '2026-09-25T08:00:00.000Z',
  meTgUserId: '438099',
  queue: { pending: 0, retrying: 0, failed24h: 0 },
};

function useDefaultHandlers(
  chats: DzhuraChatRow[] = [lunchChat, adminChat, idleChat, privateChat, privateCaptured],
  status: DzhuraStatus = freshStatus,
) {
  server.use(
    http.get(`${API}/status`, () => HttpResponse.json(status)),
    http.get(`${API}/chats`, () => HttpResponse.json(chats)),
  );
}

describe('DzhuraTab', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('показує чати, статус слухача, лунч-групу з заблокованою галочкою «Читати»', async () => {
    useDefaultHandlers();
    render(<DzhuraTab pollIntervalMs={10} />);

    expect(await screen.findByText('Обіди')).toBeInTheDocument();
    expect(screen.getByText(/Слухач активний/)).toBeInTheDocument();

    const lunchRead = screen.getByRole('checkbox', { name: 'Читати: Обіди' });
    expect(lunchRead).toBeChecked();
    expect(lunchRead).toBeDisabled();
    expect(screen.getByText('група обідів')).toBeInTheDocument();

    // «В Обране» доступне лише там, де ввімкнено читання
    expect(screen.getByRole('checkbox', { name: 'В Обране: Admin' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'В Обране: Друга група' })).toBeDisabled();
    expect(screen.getByText('40')).toBeInTheDocument();
  });

  it('особисті чати: приховані за замовчуванням, окрім тих, що вже читаються; перемикач і пошук', async () => {
    useDefaultHandlers();
    const user = userEvent.setup();
    render(<DzhuraTab pollIntervalMs={10} />);
    await screen.findByText('Admin');

    expect(screen.queryByText('Костя Іванов')).toBeNull();
    expect(screen.getByText('Оля Петренко')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /Показати особисті чати \(2\)/ }));
    expect(await screen.findByText('Костя Іванов')).toBeInTheDocument();
    expect(localStorage.getItem('dzhura.showPrivate')).toBe('1');

    await user.type(screen.getByRole('searchbox', { name: 'Пошук чату' }), 'kostya');
    expect(screen.getByText('Костя Іванов')).toBeInTheDocument();
    expect(screen.queryByText('Admin')).toBeNull();
    expect(screen.queryByText('Обіди')).toBeNull();
  });

  it('перегляд повідомлень: список, пошук і «Показати ще» з курсором', async () => {
    useDefaultHandlers();
    const requests: string[] = [];
    const row = (id: number, text: string, extra: Partial<DzhuraMessageRow> = {}): DzhuraMessageRow => ({
      id,
      tgMessageId: String(id),
      sentAt: '2026-09-25T09:30:00.000Z',
      sender: { tgUserId: '200', name: 'Костя', username: 'kostya' },
      isOutgoing: false,
      text,
      mediaKind: null,
      replyToTgMessageId: null,
      editedAt: null,
      deletedAt: null,
      source: 'live',
      reactions: [],
      reactionsCounts: null,
      ...extra,
    });
    server.use(
      http.get(`${API}/chats/2/messages`, ({ request }) => {
        const url = new URL(request.url);
        requests.push(url.search);
        const q = url.searchParams.get('q');
        const before = url.searchParams.get('beforeId');
        if (q === 'звіт') return HttpResponse.json({ messages: [row(7, 'Звіт готовий')], nextBeforeId: null });
        if (before === '8') return HttpResponse.json({ messages: [row(6, 'Старе повідомлення')], nextBeforeId: null });
        return HttpResponse.json({
          messages: [
            row(9, 'Привіт усім', { reactionsCounts: { '❤️': 2 }, editedAt: '2026-09-25T09:31:00.000Z' }),
            row(8, 'моя відповідь', { isOutgoing: true, sender: null, mediaKind: 'photo' }),
          ],
          nextBeforeId: 8,
        });
      }),
    );
    const user = userEvent.setup();
    render(<DzhuraTab pollIntervalMs={10} />);
    await screen.findByText('Admin');

    await user.click(screen.getByRole('button', { name: 'Повідомлення: Admin' }));
    const list = await screen.findByRole('list', { name: 'Повідомлення чату Admin' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByText('Привіт усім')).toBeInTheDocument();
    expect(within(list).getByText('❤️ 2')).toBeInTheDocument();
    expect(within(list).getByText('(змінено)')).toBeInTheDocument();
    expect(within(list).getByText('ви')).toBeInTheDocument();
    expect(within(list).getByText('фото')).toBeInTheDocument();
    expect(requests[0]).toBe('?limit=50');

    await user.click(screen.getByRole('button', { name: 'Показати ще' }));
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(3));
    expect(requests[1]).toBe('?beforeId=8&limit=50');
    expect(screen.queryByRole('button', { name: 'Показати ще' })).toBeNull();

    await user.type(screen.getByRole('searchbox', { name: 'Пошук у повідомленнях: Admin' }), 'звіт{Enter}');
    expect(await within(list).findByText('Звіт готовий')).toBeInTheDocument();
    expect(requests[2]).toBe('?q=%D0%B7%D0%B2%D1%96%D1%82&limit=50');
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
  });

  it('черга дублів: статистика і «Повторити невдалі»', async () => {
    useDefaultHandlers([lunchChat, adminChat], { ...freshStatus, queue: { pending: 3, retrying: 1, failed24h: 2 } });
    let posted = 0;
    server.use(
      http.post(`${API}/queue/retry-failed`, () => {
        posted += 1;
        return HttpResponse.json({ requeued: 2 });
      }),
    );
    const user = userEvent.setup();
    render(<DzhuraTab pollIntervalMs={10} />);
    expect(await screen.findByText(/Черга в Обране: 3 очікує · 1 на повторі · 2 невдалих за добу/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Повторити невдалі' }));
    expect(await screen.findByText('Повернуто в чергу: 2')).toBeInTheDocument();
    expect(posted).toBe(1);
  });

  it('прапорці шлють PATCH і застосовують відповідь', async () => {
    useDefaultHandlers();
    const patches: Array<{ id: string; body: unknown }> = [];
    server.use(
      http.patch(`${API}/chats/:id`, async ({ params, request }) => {
        const body = (await request.json()) as Record<string, boolean>;
        patches.push({ id: String(params.id), body });
        const base = params.id === '3' ? idleChat : adminChat;
        return HttpResponse.json({ ...base, ...body });
      }),
    );
    const user = userEvent.setup();
    render(<DzhuraTab pollIntervalMs={10} />);
    await screen.findByText('Admin');

    await user.click(screen.getByRole('checkbox', { name: 'В Обране: Admin' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ id: '2', body: { relayToSaved: true } });
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'В Обране: Admin' })).toBeChecked());

    await user.click(screen.getByRole('checkbox', { name: 'Читати: Друга група' }));
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[1]).toEqual({ id: '3', body: { captureEnabled: true } });
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'В Обране: Друга група' })).toBeEnabled());
  });

  it('відкат прапорця і червоний алерт, коли PATCH падає', async () => {
    useDefaultHandlers();
    server.use(http.patch(`${API}/chats/:id`, () => HttpResponse.json({ error: 'Групу обідів читаємо завжди' }, { status: 400 })));
    const user = userEvent.setup();
    render(<DzhuraTab pollIntervalMs={10} />);
    await screen.findByText('Admin');

    await user.click(screen.getByRole('checkbox', { name: 'В Обране: Admin' }));
    const alert = await screen.findByText('Групу обідів читаємо завжди');
    expect(alert.closest('.alert-error')).not.toBeNull();
    expect(screen.getByRole('checkbox', { name: 'В Обране: Admin' })).not.toBeChecked();
  });

  it('довантаження: POST задачі, прогрес через polling, «Готово»', async () => {
    useDefaultHandlers();
    const posted: unknown[] = [];
    let polls = 0;
    const jobBase: DzhuraJob = {
      id: 11,
      type: 'backfill',
      status: 'pending',
      params: { chatId: 2, from: '2026-09-01', to: '2026-09-07' },
      progress: null,
      result: null,
      errorText: null,
      createdAt: '2026-09-25T10:00:00.000Z',
      startedAt: null,
      finishedAt: null,
    };
    server.use(
      http.post(`${API}/jobs`, async ({ request }) => {
        posted.push(await request.json());
        return HttpResponse.json({ job: jobBase }, { status: 201 });
      }),
      http.get(`${API}/jobs/11`, () => {
        polls += 1;
        if (polls === 1) return HttpResponse.json({ ...jobBase, status: 'running', progress: { scanned: 120, stored: 118 } });
        return HttpResponse.json({ ...jobBase, status: 'done', result: { scanned: 250, stored: 240, updated: 10 } });
      }),
    );
    const user = userEvent.setup();
    render(<DzhuraTab pollIntervalMs={10} />);
    await screen.findByText('Admin');

    const adminRow = screen.getByText('Admin').closest('tr') as HTMLTableRowElement;
    await user.click(within(adminRow).getByRole('button', { name: 'Історія…' }));
    fireEvent.change(document.getElementById('dzhura-from-2') as HTMLInputElement, { target: { value: '2026-09-01' } });
    fireEvent.change(document.getElementById('dzhura-to-2') as HTMLInputElement, { target: { value: '2026-09-07' } });
    await user.click(screen.getByRole('button', { name: 'Довантажити з Telegram' }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ type: 'backfill', chatId: 2, from: '2026-09-01', to: '2026-09-07' });

    expect(await screen.findByText(/переглянуто 120, збережено 118/)).toBeInTheDocument();
    expect(await screen.findByText(/Готово: нових 240, оновлено 10/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Довантажити з Telegram' })).toBeEnabled();
  });

  it('експорт JSON: тягне файл з авторизацією і завантажує під ім\'ям із заголовка', async () => {
    useDefaultHandlers();
    let authHeader: string | null = null;
    let query = '';
    server.use(
      http.get(`${API}/chats/2/export`, ({ request }) => {
        authHeader = request.headers.get('Authorization');
        query = new URL(request.url).search;
        return new HttpResponse('{"project":"dzhura","messages":[]}', {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': 'attachment; filename="dzhura-admin-2026-09-01_2026-09-07.json"',
          },
        });
      }),
    );
    const { apiClient } = await import('@/api/client');
    apiClient.setAuthToken('admin-authenticated');
    // У jsdom немає URL.createObjectURL — підставляємо лише ці два методи, не чіпаючи конструктор.
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true, writable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true, writable: true });
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });

    try {
      const user = userEvent.setup();
      render(<DzhuraTab pollIntervalMs={10} />);
      await screen.findByText('Admin');
      const adminRow = screen.getByText('Admin').closest('tr') as HTMLTableRowElement;
      await user.click(within(adminRow).getByRole('button', { name: 'Історія…' }));
      fireEvent.change(document.getElementById('dzhura-from-2') as HTMLInputElement, { target: { value: '2026-09-01' } });
      fireEvent.change(document.getElementById('dzhura-to-2') as HTMLInputElement, { target: { value: '2026-09-07' } });
      await user.click(screen.getByRole('button', { name: 'Вигрузити JSON' }));

      await waitFor(() => expect(downloads).toEqual(['dzhura-admin-2026-09-01_2026-09-07.json']));
      expect(authHeader).toBe('admin-authenticated');
      expect(query).toBe('?from=2026-09-01&to=2026-09-07');
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
      expect(await screen.findByText(/завантажено/)).toBeInTheDocument();
    } finally {
      Reflect.deleteProperty(URL, 'createObjectURL');
      Reflect.deleteProperty(URL, 'revokeObjectURL');
    }
  });

  it('оновлення списку чатів: задача sync_dialogs → перезавантаження списку', async () => {
    let chatsCalls = 0;
    server.use(
      http.get(`${API}/status`, () => HttpResponse.json(freshStatus)),
      http.get(`${API}/chats`, () => {
        chatsCalls += 1;
        return HttpResponse.json(chatsCalls === 1 ? [lunchChat] : [lunchChat, adminChat]);
      }),
      http.post(`${API}/jobs`, () =>
        HttpResponse.json(
          { job: { id: 5, type: 'sync_dialogs', status: 'pending', params: null, progress: null, result: null, errorText: null, createdAt: '', startedAt: null, finishedAt: null } },
          { status: 201 },
        ),
      ),
      http.get(`${API}/jobs/5`, () =>
        HttpResponse.json({ id: 5, type: 'sync_dialogs', status: 'done', params: null, progress: null, result: { dialogs: 40, chats: 12 }, errorText: null, createdAt: '', startedAt: null, finishedAt: null }),
      ),
    );
    const user = userEvent.setup();
    render(<DzhuraTab pollIntervalMs={10} />);
    await screen.findByText('Обіди');
    expect(screen.queryByText('Admin')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Оновити список чатів' }));
    expect(await screen.findByText('Список чатів оновлено')).toBeInTheDocument();
    expect(await screen.findByText('Admin')).toBeInTheDocument();
  });

  it('статус «не відповідає» і «вимкнений»; помилка завантаження списку', async () => {
    useDefaultHandlers([lunchChat], { ...freshStatus, heartbeatFresh: false, heartbeatAt: '2026-09-25T06:00:00.000Z' });
    const { unmount } = render(<DzhuraTab pollIntervalMs={10} />);
    expect(await screen.findByText(/Слухач не відповідає/)).toBeInTheDocument();
    unmount();

    useDefaultHandlers([lunchChat], { ...freshStatus, listenerWanted: false });
    const second = render(<DzhuraTab pollIntervalMs={10} />);
    expect(await screen.findByText(/Слухач вимкнений на сервері/)).toBeInTheDocument();
    second.unmount();

    server.use(
      http.get(`${API}/status`, () => HttpResponse.json(freshStatus)),
      http.get(`${API}/chats`, () => HttpResponse.json({ error: 'База недоступна' }, { status: 500 })),
    );
    render(<DzhuraTab pollIntervalMs={10} />);
    const alert = await screen.findByText('База недоступна');
    expect(alert.closest('.alert-error')).not.toBeNull();
  });
});
