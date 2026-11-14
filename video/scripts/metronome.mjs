/**
 * Метроном 125 BPM для чернеток (замість музики, якої ще немає): public/audio/metronome-125.wav, 60 с, 48 кГц моно.
 * Сильна доля такту — вищий клік. `npm run metronome`; файл у git не потрапляє.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BPM = 125;
const RATE = 48000;
const SECONDS = 60;
const beat = 60 / BPM;
const samples = new Int16Array(RATE * SECONDS);
for (let b = 0; b * beat < SECONDS; b++) {
  const start = Math.round(b * beat * RATE);
  const accent = b % 4 === 0;
  const freq = accent ? 1600 : 1000;
  const len = Math.round(0.03 * RATE);
  for (let i = 0; i < len && start + i < samples.length; i++) {
    const env = Math.exp(-i / (len / 5));
    samples[start + i] = Math.round(Math.sin((2 * Math.PI * freq * i) / RATE) * env * (accent ? 0.55 : 0.32) * 32767);
  }
}
const data = Buffer.from(samples.buffer);
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(data.length, 40);
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'audio', 'metronome-125.wav');
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, Buffer.concat([header, data]));
console.log(`✓ ${path.relative(process.cwd(), out)}`);
