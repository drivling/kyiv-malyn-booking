import { http, HttpResponse } from 'msw';

/** Match default ApiClient base URL (`VITE_API_URL` or localhost:3000). */
export const TEST_API_URL = 'http://localhost:3000';

const emptyDataset = {
  stops: [],
  routes: [],
  routeStops: [],
  trips: [],
  segments: [],
  meta: { defaultSec: 120, center: [50.768, 29.242] as [number, number] },
};

/** Minimal API stubs for unit/integration tests. */
export const handlers = [
  http.post(`${TEST_API_URL}/admin/login`, async ({ request }) => {
    const body = (await request.json()) as { password?: string };
    if (body.password) {
      return HttpResponse.json({ success: true, token: 'admin-authenticated' });
    }
    return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }),

  http.get(`${TEST_API_URL}/admin/check`, ({ request }) => {
    const auth = request.headers.get('Authorization');
    if (auth === 'admin-authenticated') {
      return HttpResponse.json({ authenticated: true });
    }
    return HttpResponse.json({ authenticated: false }, { status: 401 });
  }),

  http.get(`${TEST_API_URL}/transport/dataset`, () => HttpResponse.json(emptyDataset)),

  http.get(`${TEST_API_URL}/trip-points`, () =>
    HttpResponse.json([
      { id: 1, code: 'Kyiv', nameUk: 'Київ', requiredOnTrip: false, appearInFromTo: true, appearInPoputky: true, sortOrder: 10 },
      { id: 2, code: 'Malyn', nameUk: 'Малин', requiredOnTrip: true, appearInFromTo: true, appearInPoputky: true, sortOrder: 20 },
      { id: 3, code: 'Irpin', nameUk: 'Ірпінь', requiredOnTrip: false, appearInFromTo: false, appearInPoputky: true, sortOrder: 50 },
    ])
  ),

  http.get(`${TEST_API_URL}/trip-routes`, () =>
    HttpResponse.json([
      { id: 1, slug: 'Kyiv-Malyn', labelUk: 'Київ → Малин', startPointId: 1, endPointId: 2, corridorTripRouteId: null },
    ])
  ),

  http.get(`${TEST_API_URL}/bookings`, () => HttpResponse.json([])),
];
