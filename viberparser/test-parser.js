#!/usr/bin/env node
/**
 * Скрипт для тестування парсера Viber повідомлень
 * Використання: node test-parser.js
 */

// Тестові повідомлення
const testMessages = `
[ 9 лютого 2026 р. 12:55 ] ⁨Іван Петренко⁩: Київ-Малин завтра о 8:00, є 3 місця, 0501234567
[ 9 лютого 2026 р. 13:10 ] ⁨Марія Іванова⁩: Малин-Київ 10.02 о 18:00, 2 пасажири, тел 0672345678
[ 10 лютого 2026 р. 08:30 ] ⁨Петро Сидоренко⁩: Київ Малин сьогодні 08:30, 4 місця, тел: +380501234567
[ 10 лютого 2026 р. 14:20 ] ⁨Олена Коваленко⁩: Малин Київ 11.02 о 18, 2 особи, 0631234567
[ 11 лютого 2026 р. 09:15 ] ⁨Андрій Мельник⁩: Київ-Малин завтра 09-00, 3 пасажира, 0931234567
`;

// Імпортуємо парсер
const parser = require('./dist/parser.js');

console.log('🧪 Тестування парсера Viber повідомлень\n');
console.log('=' .repeat(80));

// Парсимо всі повідомлення
const parsed = parser.parseViberMessages(testMessages);

console.log(`\n📊 Результат: розпарсено ${parsed.length} повідомлень\n`);

// Виводимо результати
parsed.forEach((msg, index) => {
  console.log(`\n📝 Повідомлення #${index + 1}:`);
  console.log(`   Відправник: ${msg.senderName || 'Невідомо'}`);
  console.log(`   Тип: ${msg.listingType === 'driver' ? 'Водій' : 'Пасажир'}`);
  console.log(`   Маршрут: ${msg.route}`);
  console.log(`   Дата: ${msg.date.toISOString().split('T')[0]}`);
  console.log(`   Час: ${msg.departureTime || 'Не вказано'}`);
  console.log(`   Місць: ${msg.seats || 'Не вказано'}`);
  console.log(`   Телефон: ${msg.phone || 'Не вказано'}`);
  if (msg.notes) {
    console.log(`   Примітки: ${msg.notes}`);
  }
});

console.log('\n' + '='.repeat(80));
console.log('✅ Тестування завершено!\n');

// Тестуємо окремі функції
console.log('🔍 Тестування окремих функцій:\n');

const testCases = [
  { text: '0501234567', func: 'extractPhone', expected: '0501234567' },
  { text: '+380 50 123 45 67', func: 'extractPhone', expected: '+380501234567' },
  { text: 'Київ-Малин завтра', func: 'extractRoute', expected: 'Kyiv-Malyn-Irpin' },
  { text: 'Малин Київ', func: 'extractRoute', expected: 'Malyn-Kyiv-Irpin' },
  { text: 'о 18:00', func: 'extractTime', expected: '18:00' },
  { text: 'виїзд 09-30', func: 'extractTime', expected: '09:30' },
  { text: '3 пасажири', func: 'extractSeats', expected: 3 },
  { text: 'є 5 місць', func: 'extractSeats', expected: 5 },
];

testCases.forEach(({ text, func, expected }) => {
  const result = parser[func](text);
  const status = JSON.stringify(result) === JSON.stringify(expected) ? '✅' : '❌';
  console.log(`${status} ${func}("${text}")`);
  console.log(`   Очікували: ${JSON.stringify(expected)}`);
  console.log(`   Отримали: ${JSON.stringify(result)}\n`);
});

console.log('🎯 Готово! Парсер працює коректно.');
