import express from 'express';
import { PrismaClient } from './__generated__/prisma';
import ViberBot from 'viber-bot';
import dotenv from 'dotenv';
import { parseViberMessage, parseViberMessages } from './parser';

dotenv.config();

const prisma = new PrismaClient();
const app = express();

// Формат дати для заголовка як у експорті Viber: [ 9 лютого 2026 р. 12:55 ]
const MONTH_NAMES = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
function formatMessageDateForHeader(timestamp: number): string {
  const d = new Date(timestamp);
  const day = d.getDate();
  const month = MONTH_NAMES[d.getMonth()];
  const year = d.getFullYear();
  const h = d.getHours();
  const m = d.getMinutes();
  return `${day} ${month} ${year} р. ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const PORT = process.env.PORT || 3001;
const VIBER_BOT_TOKEN = process.env.VIBER_BOT_TOKEN;
const VIBER_BOT_NAME = process.env.VIBER_BOT_NAME || 'RideParserBot';
const VIBER_WEBHOOK_URL = process.env.VIBER_WEBHOOK_URL;

// Створення Viber бота (якщо є токен)
let bot: any = null;
if (VIBER_BOT_TOKEN) {
  try {
    bot = new ViberBot.Bot({
      authToken: VIBER_BOT_TOKEN,
      name: VIBER_BOT_NAME,
      avatar: 'https://via.placeholder.com/150',
    });
    console.log('✅ Viber Bot initialized');
  } catch (error) {
    console.warn('⚠️  Failed to initialize Viber Bot:', error);
  }
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text({ limit: '10mb' })); // Для великих текстових файлів

// Webhook endpoint для Viber (якщо бот створено)
if (bot) {
  app.use('/viber/webhook', bot.middleware());
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'viber-parser' });
});

// API: Отримати оголошення (та сама таблиця ViberListing, що й на backend)
app.get('/api/rides', async (req, res) => {
  try {
    const { active = 'true', limit = '50' } = req.query;
    const listings = await prisma.viberListing.findMany({
      where: active === 'true' ? { isActive: true } : {},
      orderBy: [{ date: 'asc' }, { createdAt: 'desc' }],
      take: parseInt(limit as string, 10),
    });
    res.json(listings);
  } catch (error) {
    console.error('Error fetching listings:', error);
    res.status(500).json({ error: 'Failed to fetch listings' });
  }
});

// API: Статистика (по таблиці ViberListing)
app.get('/api/stats', async (req, res) => {
  try {
    const [total, active] = await Promise.all([
      prisma.viberListing.count(),
      prisma.viberListing.count({ where: { isActive: true } }),
    ]);
    res.json({
      totalListings: total,
      activeListings: active,
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// API: Імпорт експортованих повідомлень з Viber → ViberListing (як на backend)
app.post('/api/import', async (req, res) => {
  try {
    const rawMessages = typeof req.body === 'string' ? req.body : req.body.messages;
    if (!rawMessages || typeof rawMessages !== 'string') {
      return res.status(400).json({ error: 'Invalid input. Send raw exported Viber chat as text.' });
    }
    console.log(`📥 Імпорт повідомлень, розмір: ${rawMessages.length} символів`);
    const messages = rawMessages.split(/\n(?=\[)/);
    let imported = 0;
    let skipped = 0;
    let errors = 0;
    for (const trimmed of messages) {
      const message = trimmed.trim();
      if (!message || message.length < 10) continue;
      try {
        const existing = await prisma.viberListing.findFirst({
          where: { rawMessage: message },
        });
        if (existing) {
          skipped++;
          continue;
        }
        const parsed = parseViberMessage(message);
        if (!parsed) {
          errors++;
          continue;
        }
        await prisma.viberListing.create({
          data: {
            rawMessage: message,
            senderName: parsed.senderName,
            listingType: parsed.listingType,
            route: parsed.route,
            date: parsed.date,
            departureTime: parsed.departureTime,
            seats: parsed.seats,
            phone: parsed.phone || '',
            notes: parsed.notes,
            isActive: true,
          },
        });
        imported++;
      } catch (err) {
        console.error('Error saving message:', err);
        errors++;
      }
    }
    console.log(`✅ Імпорт: ${imported} створено, ${skipped} пропущено, ${errors} помилок`);
    res.json({ success: true, imported, skipped, errors, total: messages.length });
  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({ error: 'Failed to import messages' });
  }
});

// API: Деактивувати старі оголошення (старіші за N днів)
app.post('/api/deactivate-old', async (req, res) => {
  try {
    const { days = 7 } = req.body || {};
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - (Number(days) || 7));
    cutoffDate.setHours(23, 59, 59, 999);
    const result = await prisma.viberListing.updateMany({
      where: { date: { lt: cutoffDate }, isActive: true },
      data: { isActive: false },
    });
    res.json({ success: true, deactivated: result.count });
  } catch (error) {
    console.error('Error deactivating old listings:', error);
    res.status(500).json({ error: 'Failed to deactivate old listings' });
  }
});

// Обробка повідомлень з Viber Bot → збереження в ViberListing (та сама таблиця, що на backend)
if (bot) {
  bot.onTextMessage(/.*/, async (message: any, response: any) => {
    console.log(`📩 New message from ${message.sender.name}: ${message.text}`);
    try {
      const headerDate = formatMessageDateForHeader(message.timestamp);
      const rawMessage = `[ ${headerDate} ] ⁨${message.sender.name || 'User'}⁩: ${message.text}`;
      const existing = await prisma.viberListing.findFirst({
        where: { rawMessage },
      });
      if (existing) {
        console.log(`⏭️  Duplicate message skipped`);
        return;
      }
      const parsed = parseViberMessage(rawMessage);
      if (parsed) {
        await prisma.viberListing.create({
          data: {
            rawMessage,
            senderName: parsed.senderName ?? message.sender.name ?? null,
            listingType: parsed.listingType,
            route: parsed.route,
            date: parsed.date,
            departureTime: parsed.departureTime,
            seats: parsed.seats,
            phone: parsed.phone || '',
            notes: parsed.notes,
            isActive: true,
          },
        });
        console.log(`✅ Saved to ViberListing: ${parsed.route} on ${parsed.date}`);
      } else {
        console.log(`⚠️  Message not parsed (unknown route or format), not saved`);
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  bot.onSubscribe((response: any) => {
    console.log(`👋 New subscriber!`);
    response.send(new ViberBot.Message.Text(
      'Привіт! Я бот для збору оголошень про поїздки. Додай мене до групи, щоб я міг збирати інформацію.'
    ));
  });
}

// Встановлення webhook (якщо бот створено і є URL)
async function setupWebhook() {
  if (!bot || !VIBER_WEBHOOK_URL) {
    return;
  }
  
  try {
    await bot.setWebhook(VIBER_WEBHOOK_URL);
    console.log(`✅ Webhook set to: ${VIBER_WEBHOOK_URL}`);
  } catch (error) {
    console.error('❌ Failed to set webhook:', error);
  }
}

// Запуск сервера
app.listen(PORT, async () => {
  console.log(`🚀 Viber Parser Service running on port ${PORT}`);
  console.log(``);
  
  if (bot) {
    console.log(`🤖 Viber Bot: ${VIBER_BOT_NAME}`);
    if (process.env.NODE_ENV !== 'development' && VIBER_WEBHOOK_URL) {
      await setupWebhook();
    } else {
      console.log(`⚠️  Development mode: webhook not set automatically`);
      console.log(`   Set VIBER_WEBHOOK_URL and redeploy to enable bot`);
    }
  } else {
    console.log(`ℹ️  Viber Bot disabled (no VIBER_BOT_TOKEN)`);
    console.log(`   Working in import-only mode`);
  }
  
  console.log(``);
  console.log(`📊 API endpoints:`);
  console.log(`   GET  /health - перевірка стану`);
  console.log(`   GET  /api/rides - список оголошень (ViberListing)`);
  console.log(`   GET  /api/stats - статистика`);
  console.log(`   POST /api/import - імпорт експортованого чату`);
  console.log(`   POST /api/deactivate-old - деактивувати старі`);
  if (bot) {
    console.log(`   POST /viber/webhook - Viber Bot webhook`);
  }
  console.log(``);
  console.log(`💡 Два режими роботи:`);
  console.log(`   1. Bot mode: додайте бота до групи (потрібен токен)`);
  console.log(`   2. Import mode: експортуйте чат і відправте POST /api/import`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing server...');
  await prisma.$disconnect();
  process.exit(0);
});
