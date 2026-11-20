/**
 * Сервер для HTTP-тестів, що слухає саме 127.0.0.1.
 *
 * `request(app)` у supertest слухає `::` (порт 0), а стукає на `127.0.0.1:<порт>`. На macOS той самий
 * порт може вже тримати інший процес саме на 127.0.0.1 — тоді відповідає він, а не наш app (так
 * 2026-11-20 тест звітів про прибуття отримав 404 від чужого сервера). Сокет, прив'язаний явно до
 * 127.0.0.1, такий порт не отримає.
 *
 * Слухання з адресою асинхронне, тож сервер треба дочекатися: `request(await listenLocal(app))`.
 * supertest не закриває сервер, який запустив не він, тому кожен сервер закривається після тесту
 * (`afterEach` нижче). Не входить у `dist` (`exclude` у tsconfig.json).
 */
import http from 'node:http';
import { afterEach } from 'vitest';

export type LocalServer = http.Server;

const open = new Set<http.Server>();

export async function listenLocal(app: http.RequestListener): Promise<LocalServer> {
  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  open.add(server);
  return server;
}

afterEach(async () => {
  const servers = [...open];
  open.clear();
  await Promise.all(
    servers.map(
      (s) =>
        new Promise<void>((resolve) => {
          s.close(() => resolve());
          s.closeAllConnections();
        }),
    ),
  );
});
