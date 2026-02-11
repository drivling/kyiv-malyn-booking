import express from 'express';
import { PrismaClient } from '@prisma/client';
import ViberBot from 'viber-bot';
import dotenv from 'dotenv';
import { MessageParser } from './parser';

dotenv.config();

const prisma = new PrismaClient();
const app = express();
const parser = new MessageParser();

const PORT = process.env.PORT || 3001;
const VIBER_BOT_TOKEN = process.env.VIBER_BOT_TOKEN!;
const VIBER_BOT_NAME = process.env.VIBER_BOT_NAME || 'RideParserBot';
const VIBER_WEBHOOK_URL = process.env.VIBER_WEBHOOK_URL!;

if (!VIBER_BOT_TOKEN) {
  console.error('❌ VIBER_BOT_TOKEN is required!');
  process.exit(1);
}

// Створення Viber бота
const bot = new ViberBot.Bot({
  authToken: VIBER_BOT_TOKEN,
  name: VIBER_BOT_NAME,
  avatar: 'https://via.placeholder.com/150', // Можна додати своє лого
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Webhook endpoint для Viber
app.use('/viber/webhook', bot.middleware());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'viber-parser' });
});

// API: Отримати всі розпарсені поїздки
app.get('/api/rides', async (req, res) => {
  try {
    const { active = 'true', parsed = 'true', limit = '50' } = req.query;
    
    const rides = await prisma.viberRide.findMany({
      where: {
        isActive: active === 'true',
        isParsed: parsed === 'true',
      },
      orderBy: {
        departureDate: 'asc',
      },
      take: parseInt(limit as string, 10),
    });
    
    res.json(rides);
  } catch (error) {
    console.error('Error fetching rides:', error);
    res.status(500).json({ error: 'Failed to fetch rides' });
  }
});

// API: Статистика парсера
app.get('/api/stats', async (req, res) => {
  try {
    const [total, parsed, active, state] = await Promise.all([
      prisma.viberRide.count(),
      prisma.viberRide.count({ where: { isParsed: true } }),
      prisma.viberRide.count({ where: { isActive: true } }),
      prisma.viberParserState.findFirst(),
    ]);
    
    res.json({
      totalMessages: total,
      parsedMessages: parsed,
      activeRides: active,
      parsingRate: total > 0 ? ((parsed / total) * 100).toFixed(2) + '%' : '0%',
      lastCheck: state?.lastCheckTime,
      messagesProcessed: state?.messagesProcessed || 0,
      errors: state?.errors || 0,
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Обробка повідомлень з Viber
bot.onTextMessage(/.*/, async (message: any, response: any) => {
  console.log(`📩 New message from ${message.sender.name}: ${message.text}`);
  
  try {
    const messageId = `${message.chatId}_${message.timestamp}`;
    const timestamp = new Date(message.timestamp);
    
    // Перевірка чи повідомлення вже оброблене
    const existing = await prisma.viberRide.findUnique({
      where: { messageId },
    });
    
    if (existing) {
      console.log(`⏭️  Message already processed: ${messageId}`);
      return;
    }
    
    // Парсинг повідомлення
    const parsed = parser.parse(message.text, timestamp);
    
    // Збереження в базу
    await prisma.viberRide.create({
      data: {
        messageId,
        messageText: message.text,
        senderName: message.sender.name,
        senderId: message.sender.id,
        messageTimestamp: timestamp,
        ...parsed,
      },
    });
    
    // Оновлення стану парсера
    await updateParserState(messageId);
    
    if (parsed.isParsed) {
      console.log(`✅ Message parsed successfully: ${parsed.route} on ${parsed.departureDate}`);
      
      // Можна відправити підтвердження (опціонально)
      // await response.send(new ViberBot.Message.Text('Оголошення збережено!'));
    } else {
      console.log(`⚠️  Message parsing incomplete: ${parsed.parsingErrors}`);
    }
    
  } catch (error) {
    console.error('Error processing message:', error);
    await updateParserState(null, true);
  }
});

// Обробка події підписки
bot.onSubscribe((response: any) => {
  console.log(`👋 New subscriber!`);
  response.send(new ViberBot.Message.Text(
    'Привіт! Я бот для збору оголошень про поїздки. Додай мене до групи, щоб я міг збирати інформацію.'
  ));
});

// Оновлення стану парсера
async function updateParserState(lastMessageId: string | null, isError = false) {
  const state = await prisma.viberParserState.findFirst();
  
  if (state) {
    await prisma.viberParserState.update({
      where: { id: state.id },
      data: {
        lastMessageId: lastMessageId || state.lastMessageId,
        lastCheckTime: new Date(),
        messagesProcessed: isError ? state.messagesProcessed : state.messagesProcessed + 1,
        errors: isError ? state.errors + 1 : state.errors,
      },
    });
  } else {
    await prisma.viberParserState.create({
      data: {
        lastMessageId,
        messagesProcessed: isError ? 0 : 1,
        errors: isError ? 1 : 0,
      },
    });
  }
}

// Встановлення webhook
async function setupWebhook() {
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
  console.log(`📱 Bot name: ${VIBER_BOT_NAME}`);
  
  if (process.env.NODE_ENV !== 'development') {
    await setupWebhook();
  } else {
    console.log('⚠️  Development mode: webhook not set automatically');
    console.log('   Use ngrok or similar tool for local testing');
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing server...');
  await prisma.$disconnect();
  process.exit(0);
});
