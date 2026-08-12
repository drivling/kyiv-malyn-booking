import type { Page, Route } from '@playwright/test';

const API_HOST = /localhost:3000|127\.0\.0\.1:3000/;

export async function dismissCookieNotice(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('malin_kiev_ua_cookie_notice_v1', '1');
    } catch {
      /* ignore */
    }
  });
}

async function json(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

/** Mock backend API the built client calls (default http://localhost:3000). */
export async function mockBackendApi(page: Page) {
  await page.route((url) => API_HOST.test(url.host), async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const path = u.pathname;
    const method = req.method();

    if (method === 'POST' && path === '/admin/login') {
      const body = req.postDataJSON() as { password?: string };
      if (body?.password) {
        return json(route, 200, { success: true, token: 'admin-authenticated' });
      }
      return json(route, 401, { error: 'Невірний пароль' });
    }

    if (method === 'GET' && path === '/admin/check') {
      const auth = req.headers()['authorization'];
      if (auth === 'admin-authenticated') {
        return json(route, 200, { authenticated: true });
      }
      return json(route, 401, { error: 'Unauthorized' });
    }

    if (method === 'GET' && path === '/bookings') {
      return json(route, 200, []);
    }

    if (method === 'GET' && path === '/transport/dataset') {
      return json(route, 200, {
        stops: [
          { id: 'st_a', name: 'Базар', lat: 50.77, lng: 29.24 },
          { id: 'st_b', name: 'Вокзал', lat: 50.78, lng: 29.25 },
        ],
        routes: [
          {
            id: '2',
            fromName: 'Базар',
            toName: 'Вокзал',
            scheme: 'city',
            note: '',
            sourceUrl: '',
            schedule: null,
          },
        ],
        routeStops: [
          { routeId: '2', stopId: 'st_a', orderThere: 1, orderBack: 2, mapOnly: false },
          { routeId: '2', stopId: 'st_b', orderThere: 2, orderBack: 1, mapOnly: false },
        ],
        trips: [
          {
            id: 't1',
            routeId: '2',
            serviceId: 'everyday',
            headsign: 'Вокзал',
            directionId: '1',
            departureTime: '08:30:00',
            blockId: null,
          },
        ],
        segments: [{ routeId: '2', fromStopId: 'st_a', toStopId: 'st_b', seconds: 240 }],
        meta: { defaultSec: 120, center: [50.768, 29.242] },
      });
    }

    if (method === 'GET' && path === '/viber-listings') {
      return json(route, 200, []);
    }

    if (method === 'GET' && path.startsWith('/schedules/')) {
      // /schedules/:route or /schedules/:route/:time/availability
      if (path.includes('/availability')) {
        return json(route, 200, {
          availableSeats: 5,
          maxSeats: 8,
          isAvailable: true,
          bookedSeats: 3,
        });
      }
      const routeId = decodeURIComponent(path.replace('/schedules/', '').split('?')[0]);
      if (routeId.startsWith('Korosten-Malyn') || routeId.startsWith('Malyn-Korosten')) {
        return json(route, 200, [
          {
            id: 201,
            route: routeId,
            departureTime: '07:10',
            maxSeats: 0,
            priceUah: null,
            supportPhone: null,
            vehicleType: 'elektrichka',
            tripNumber: '6102',
            ticketPurchaseUrl: 'https://tickets.example/buy',
            boardingPlace: 'Вокзал',
            alightingPlace: null,
            activeWeekdays: [1, 2, 3, 4, 5, 6, 7],
          },
        ]);
      }
      return json(route, 200, [
        {
          id: 101,
          route: routeId,
          departureTime: '09:00',
          maxSeats: 8,
          priceUah: 280,
          supportPhone: '+380501112233',
          vehicleType: 'marshrutka',
          activeWeekdays: [1, 2, 3, 4, 5, 6, 7],
          isActive: true,
        },
      ]);
    }

    if (method === 'GET' && path === '/trip-points') {
      return json(route, 200, [
        { id: 1, code: 'Kyiv', nameUk: 'Київ', requiredOnTrip: false, appearInFromTo: true, sortOrder: 10 },
        { id: 2, code: 'Malyn', nameUk: 'Малин', requiredOnTrip: true, appearInFromTo: true, sortOrder: 20 },
        { id: 3, code: 'Korosten', nameUk: 'Коростень', requiredOnTrip: false, appearInFromTo: true, sortOrder: 40 },
      ]);
    }

    if (method === 'GET' && path === '/trip-routes') {
      return json(route, 200, [
        { id: 1, slug: 'Kyiv-Malyn', labelUk: 'Київ → Малин', startPointId: 1, endPointId: 2, corridorTripRouteId: null },
        { id: 2, slug: 'Malyn-Kyiv', labelUk: 'Малин → Київ', startPointId: 2, endPointId: 1, corridorTripRouteId: null },
        { id: 3, slug: 'Korosten-Malyn', labelUk: 'Коростень → Малин', startPointId: 3, endPointId: 2, corridorTripRouteId: null },
      ]);
    }

    if (method === 'GET' && path === '/schedules') {
      return json(route, 200, []);
    }

    if (method === 'POST' && path === '/bookings') {
      const body = req.postDataJSON() as Record<string, unknown>;
      return json(route, 201, {
        id: 1,
        ...body,
        createdAt: new Date().toISOString(),
      });
    }

    if (method === 'GET' && path.includes('telegram')) {
      return json(route, 200, { enabled: true, scenarios: {} });
    }

    // Soft default so incidental calls do not fail the page
    return json(route, 200, {});
  });
}
