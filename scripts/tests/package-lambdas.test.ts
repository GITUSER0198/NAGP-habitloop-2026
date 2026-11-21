import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32, zipSingleFile } from '../package-lambdas.js';

describe('zipSingleFile', () => {
  const content = Buffer.from('exports.handler = async () => ({ ok: true });\n'.repeat(20));
  const archive = zipSingleFile('handler.js', content);

  it('has the standard record signatures and one entry', () => {
    expect(archive.readUInt32LE(0)).toBe(0x04034b50);
    const end = archive.length - 22;
    expect(archive.readUInt32LE(end)).toBe(0x06054b50);
    expect(archive.readUInt16LE(end + 10)).toBe(1);
    expect(archive.readUInt32LE(archive.readUInt32LE(end + 16))).toBe(0x02014b50);
  });

  it('round-trips the file name, bytes and checksum', () => {
    const nameLength = archive.readUInt16LE(26);
    expect(archive.subarray(30, 30 + nameLength).toString()).toBe('handler.js');
    const packedLength = archive.readUInt32LE(18);
    const packed = archive.subarray(30 + nameLength, 30 + nameLength + packedLength);
    const restored = inflateRawSync(packed);
    expect(restored.equals(content)).toBe(true);
    expect(archive.readUInt32LE(14)).toBe(crc32(restored));
  });

  it('is deterministic and stamped 2020-01-01 with mode 0644', () => {
    expect(zipSingleFile('handler.js', content).equals(archive)).toBe(true);
    expect(archive.readUInt16LE(12)).toBe(((2020 - 1980) << 9) | (1 << 5) | 1);
    const central = archive.readUInt32LE(archive.length - 22 + 16);
    expect(archive.readUInt32LE(central + 38) >>> 16).toBe(0o100644);
  });

  it('computes the standard CRC-32 check value', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });
});
