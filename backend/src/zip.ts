/**
 * Мінімальний запис ZIP (PKZIP 2.0: local file header + central directory + end of central directory),
 * достатній для GTFS-фіду з кількох текстових файлів (Docs/transport-open-data-2026-10.md).
 * Без залежностей і без системного `zip`: deflate — `zlib.deflateRawSync`, CRC-32 — таблиця нижче.
 * Детермінований: однакові записи й `mtime` → ті самі байти (кеш за revision, два контейнери).
 */
import { deflateRawSync } from 'zlib';

export interface ZipEntry {
  /** Ім'я у архіві (без шляху — файли лежать у корені) */
  name: string;
  data: Buffer | string;
}

export interface ZipOptions {
  /** Час усіх файлів у архіві (DOS-час має роздільність 2 с, діапазон 1980–2107) */
  mtime?: Date;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** DOS date/time (UTC-поля беруться як є — у zip немає зони) */
function dosDateTime(d: Date): { date: number; time: number } {
  const year = Math.min(Math.max(d.getUTCFullYear(), 1980), 2107);
  const date = ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
  return { date, time };
}

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
/** Біт 11 general purpose flag: імена в UTF-8 */
const FLAG_UTF8 = 0x0800;

export function buildZip(entries: ZipEntry[], options: ZipOptions = {}): Buffer {
  const { date, time } = dosDateTime(options.mtime ?? new Date(0));
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const deflated = deflateRawSync(raw);
    // Стиснення, лише коли воно справді менше — порожній чи дрібний файл лишається як є
    const method = deflated.length < raw.length ? METHOD_DEFLATE : METHOD_STORE;
    const body = method === METHOD_DEFLATE ? deflated : raw;
    const crc = crc32(raw);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    locals.push(local, body);
    centrals.push(central);
    offset += local.length + body.length;
  }

  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, ...centrals, eocd]);
}
