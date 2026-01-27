
import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { sendBookingNotificationToAdmin, isTelegramEnabled } from './telegram';

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

// Простий токен для авторизації (в продакшені використовуйте JWT)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_TOKEN = 'admin-authenticated';

// Middleware для перевірки авторизації адміна
const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const token = req.headers.authorization;
  if (token === ADMIN_TOKEN) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Авторизація адміна
app.post('/admin/login', async (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ token: ADMIN_TOKEN, success: true });
  } else {
    res.status(401).json({ error: 'Невірний пароль' });
  }
});

// Перевірка авторизації
app.get('/admin/check', requireAdmin, (_req, res) => {
  res.json({ authenticated: true });
});

// Schedule CRUD endpoints
app.get('/schedules', async (req, res) => {
  const { route } = req.query;
  const where = route ? { route: route as string } : {};
  const schedules = await prisma.schedule.findMany({
    where,
    orderBy: [{ route: 'asc' }, { departureTime: 'asc' }]
  });
  res.json(schedules);
});

app.get('/schedules/:route', async (req, res) => {
  const { route } = req.params;
  const schedules = await prisma.schedule.findMany({
    where: { route },
    orderBy: { departureTime: 'asc' }
  });
  res.json(schedules);
});

// Перевірка доступності місць для конкретного рейсу та дати
app.get('/schedules/:route/:departureTime/availability', async (req, res) => {
  const { route, departureTime } = req.params;
  const { date } = req.query;

  if (!date) {
    return res.status(400).json({ error: 'Date parameter is required' });
  }

  try {
    // Знаходимо графік
    const schedule = await prisma.schedule.findUnique({
      where: {
        route_departureTime: {
          route,
          departureTime
        }
      }
    });

    if (!schedule) {
      return res.status(404).json({ error: 'Schedule not found' });
    }

    // Підраховуємо зайняті місця для цієї дати та часу
    const bookingDate = new Date(date as string);
    const startOfDay = new Date(bookingDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(bookingDate);
    endOfDay.setHours(23, 59, 59, 999);

    const bookings = await prisma.booking.findMany({
      where: {
        route,
        departureTime,
        date: {
          gte: startOfDay,
          lte: endOfDay
        }
      }
    });

    const bookedSeats = bookings.reduce((sum, booking) => sum + booking.seats, 0);
    const availableSeats = schedule.maxSeats - bookedSeats;

    res.json({
      scheduleId: schedule.id,
      maxSeats: schedule.maxSeats,
      bookedSeats,
      availableSeats,
      isAvailable: availableSeats > 0
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to check availability' });
  }
});

app.post('/schedules', requireAdmin, async (req, res) => {
  const { route, departureTime, maxSeats } = req.body;
  if (!route || !departureTime) {
    return res.status(400).json({ error: 'Missing fields: route and departureTime are required' });
  }

  // Валідація формату часу (HH:MM)
  const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
  if (!timeRegex.test(departureTime)) {
    return res.status(400).json({ error: 'Invalid time format. Use HH:MM (e.g., 08:00)' });
  }

  try {
    const schedule = await prisma.schedule.create({
      data: { 
        route, 
        departureTime,
        maxSeats: maxSeats ? Number(maxSeats) : 20
      }
    });
    res.status(201).json(schedule);
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Schedule with this route and time already exists' });
    }
    res.status(500).json({ error: 'Failed to create schedule' });
  }
});

app.put('/schedules/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { route, departureTime, maxSeats } = req.body;

  if (!route || !departureTime) {
    return res.status(400).json({ error: 'Missing fields: route and departureTime are required' });
  }

  // Валідація формату часу
  const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
  if (!timeRegex.test(departureTime)) {
    return res.status(400).json({ error: 'Invalid time format. Use HH:MM (e.g., 08:00)' });
  }

  try {
    const schedule = await prisma.schedule.update({
      where: { id: Number(id) },
      data: { 
        route, 
        departureTime,
        maxSeats: maxSeats ? Number(maxSeats) : undefined
      }
    });
    res.json(schedule);
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Schedule not found' });
    }
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Schedule with this route and time already exists' });
    }
    res.status(500).json({ error: 'Failed to update schedule' });
  }
});

app.delete('/schedules/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.schedule.delete({
      where: { id: Number(id) }
    });
    res.status(204).send();
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Schedule not found' });
    }
    res.status(500).json({ error: 'Failed to delete schedule' });
  }
});

// Booking endpoints
app.post('/bookings', async (req, res) => {
  const { route, date, departureTime, seats, name, phone, scheduleId } = req.body;
  if (!route || !date || !departureTime || !seats || !name || !phone) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Валідація формату часу
  const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
  if (!timeRegex.test(departureTime)) {
    return res.status(400).json({ error: 'Invalid time format. Use HH:MM (e.g., 08:00)' });
  }

  // Перевірка доступності місць
  try {
    const schedule = await prisma.schedule.findUnique({
      where: {
        route_departureTime: {
          route,
          departureTime
        }
      }
    });

    if (schedule) {
      const bookingDate = new Date(date);
      const startOfDay = new Date(bookingDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(bookingDate);
      endOfDay.setHours(23, 59, 59, 999);

      const existingBookings = await prisma.booking.findMany({
        where: {
          route,
          departureTime,
          date: {
            gte: startOfDay,
            lte: endOfDay
          }
        }
      });

      const bookedSeats = existingBookings.reduce((sum, booking) => sum + booking.seats, 0);
      const requestedSeats = Number(seats);
      const availableSeats = schedule.maxSeats - bookedSeats;

      if (requestedSeats > availableSeats) {
        return res.status(400).json({ 
          error: `Недостатньо місць. Доступно: ${availableSeats}, запитується: ${requestedSeats}` 
        });
      }
    }
  } catch (error) {
    // Якщо графік не знайдено, все одно дозволяємо бронювання
  }

  const booking = await prisma.booking.create({
    data: {
      route,
      date: new Date(date),
      departureTime,
      seats: Number(seats),
      name,
      phone,
      scheduleId: scheduleId ? Number(scheduleId) : null
    }
  });

  // Відправка повідомлення адміну в Telegram (якщо налаштовано)
  if (isTelegramEnabled()) {
    try {
      await sendBookingNotificationToAdmin({
        id: booking.id,
        route: booking.route,
        date: booking.date,
        departureTime: booking.departureTime,
        seats: booking.seats,
        name: booking.name,
        phone: booking.phone,
      });
    } catch (error) {
      console.error('Помилка відправки Telegram повідомлення:', error);
      // Не блокуємо бронювання якщо Telegram не працює
    }
  }

  res.status(201).json(booking);
});

app.get('/bookings', requireAdmin, async (_req, res) => {
  res.json(await prisma.booking.findMany({ orderBy: { createdAt: 'desc' }}));
});

// Пошук останнього бронювання по телефону
app.get('/bookings/by-phone/:phone', async (req, res) => {
  const { phone } = req.params;
  try {
    const lastBooking = await prisma.booking.findFirst({
      where: { phone },
      orderBy: { createdAt: 'desc' },
    });
    res.json(lastBooking || null);
  } catch (error) {
    res.status(500).json({ error: 'Failed to find booking' });
  }
});

app.delete('/bookings/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.booking.delete({
      where: { id: Number(id) }
    });
    res.status(204).send();
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Booking not found' });
    }
    res.status(500).json({ error: 'Failed to delete booking' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`));
