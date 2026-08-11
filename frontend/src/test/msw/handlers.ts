import { http, HttpResponse } from 'msw';

/** Minimal API stubs for unit/integration tests (expand in iter 2). */
export const handlers = [
  http.post('/api/admin/login', async ({ request }) => {
    const body = (await request.json()) as { password?: string };
    if (body.password) {
      return HttpResponse.json({ success: true, token: 'admin-authenticated' });
    }
    return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }),

  http.get('/api/admin/check', ({ request }) => {
    const auth = request.headers.get('Authorization');
    if (auth === 'admin-authenticated') {
      return HttpResponse.json({ authenticated: true });
    }
    return HttpResponse.json({ authenticated: false }, { status: 401 });
  }),

  http.get('/api/transport/dataset', () =>
    HttpResponse.json({
      stops: [],
      routes: [],
      routeStops: [],
      trips: [],
      segments: [],
      meta: { defaultSec: 120, center: [50.768, 29.242] },
    })
  ),
];
