import { test } from 'vitest';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'zlib';
import { buildZip, crc32 } from './zip';

/** Читач за central directory — так само, як розпаковують `unzip` і браузери */
function readZip(zip: Buffer): Array<{ name: string; data: Buffer; method: number; crc: number }> {
  const eocd = zip.length - 22;
  assert.equal(zip.readUInt32LE(eocd), 0x06054b50, 'EOCD signature');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(p), 0x02014b50, 'central header signature');
    const method = zip.readUInt16LE(p + 10);
    const crc = zip.readUInt32LE(p + 16);
    const compressed = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localOffset = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    assert.equal(zip.readUInt32LE(localOffset), 0x04034b50, 'local header signature');
    const localNameLen = zip.readUInt16LE(localOffset + 26);
    const localExtraLen = zip.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const body = zip.subarray(start, start + compressed);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    out.push({ name, data, method, crc });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

test('crc32 matches the reference value for "123456789"', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test('buildZip: entries round-trip through the central directory, text is deflated, tiny files are stored', () => {
  const big = 'stop_id,stop_name\n' + Array.from({ length: 200 }, (_, i) => `st_${i},Зупинка ${i}`).join('\n') + '\n';
  const zip = buildZip(
    [
      { name: 'stops.txt', data: big },
      { name: 'empty.txt', data: '' },
      { name: 'bin.dat', data: Buffer.from([1, 2, 3]) },
    ],
    { mtime: new Date('2026-10-14T18:03:11Z') }
  );
  const entries = readZip(zip);
  assert.deepEqual(
    entries.map((e) => e.name),
    ['stops.txt', 'empty.txt', 'bin.dat']
  );
  assert.equal(entries[0].data.toString('utf8'), big);
  assert.equal(entries[0].method, 8);
  assert.equal(entries[0].crc, crc32(Buffer.from(big)));
  assert.equal(entries[1].data.length, 0);
  assert.equal(entries[1].method, 0);
  assert.deepEqual([...entries[2].data], [1, 2, 3]);
  // DOS-час у local header: 18:03:10 (роздільність 2 с), 2026-10-14
  const time = zip.readUInt16LE(10);
  const date = zip.readUInt16LE(12);
  assert.equal(time, (18 << 11) | (3 << 5) | (11 >> 1));
  assert.equal(date, ((2026 - 1980) << 9) | (10 << 5) | 14);
});

test('buildZip is deterministic for the same entries and mtime', () => {
  const entries = [{ name: 'a.txt', data: 'a,b\n1,2\n'.repeat(50) }];
  const opts = { mtime: new Date('2026-01-01T00:00:00Z') };
  assert.ok(buildZip(entries, opts).equals(buildZip(entries, opts)));
  assert.ok(!buildZip(entries, opts).equals(buildZip(entries, { mtime: new Date('2026-01-02T00:00:00Z') })));
});
