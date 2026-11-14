/**
 * Вигадані попутки для зйомки (жодних справжніх людей і номерів). Номер +380 00 … не може існувати:
 * коду оператора 00 немає — у ролику ніхто не подзвонить чужій людині.
 */
export const FAKE_CONTACT = '+380001234567';

export function fakeRides(date) {
  const base = { listingType: 'driver', isActive: true, createdAt: '', updatedAt: '', date };
  return [
    { ...base, id: 9001, senderName: 'Сергій', route: 'Kyiv-Malyn', departureTime: '07:00', seats: 3, notes: null, priceUah: 250 },
    { ...base, id: 9002, senderName: 'Роман З.', route: 'Kyiv-Malyn', departureTime: '08:20-08:30', seats: 2, notes: null, priceUah: null },
    { ...base, id: 9003, senderName: 'Андрій Г.', route: 'Kyiv-Malyn', departureTime: '08:30', seats: null, notes: 'м. Житомирська', priceUah: 250 },
    { ...base, id: 9004, senderName: 'Олена', route: 'Kyiv-Malyn', departureTime: '17:30', seats: 1, notes: 'від Академмістечка', priceUah: 300 },
    { ...base, id: 9011, senderName: 'Віталій', route: 'Malyn-Kyiv', departureTime: '06:30', seats: 3, notes: 'з центру', priceUah: 250 },
    { ...base, id: 9012, senderName: 'Ірина К.', route: 'Malyn-Kyiv', departureTime: '07:15-07:30', seats: 2, notes: 'до Святошина', priceUah: null },
    { ...base, id: 9013, senderName: 'Максим', route: 'Malyn-Kyiv', departureTime: '09:00', seats: null, notes: 'є місця', priceUah: 250 },
  ];
}
