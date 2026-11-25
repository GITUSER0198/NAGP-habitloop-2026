// Build the Node.js 22 Lambda ZIPs in the project root.
//
// Each ZIP holds one file, handler.js: the esbuild bundle (lambdas/<name>/dist/handler.js)
// with the shared library, jose and the AWS SDK clients inlined, so no node_modules ship.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FUNCTIONS = ['event-normalizer', 'analytics-updater'];

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A one-entry ZIP with a fixed 2020-01-01 timestamp and mode 0644, so identical
 * input always gives an identical archive.
 */
export function zipSingleFile(name: string, content: Buffer): Buffer {
  const fileName = Buffer.from(name, 'utf-8');
  const packed = deflateRawSync(content);
  const checksum = crc32(content);
  const dosTime = 0;
  const dosDate = ((2020 - 1980) << 9) | (1 << 5) | 1;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0, 6); // flags
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(fileName.length, 26);
  local.writeUInt16LE(0, 28);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE((3 << 8) | 20, 4); // made by Unix, so the mode below applies
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(dosTime, 12);
  central.writeUInt16LE(dosDate, 14);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(fileName.length, 28);
  central.writeUInt32LE(((0o100644 << 16) >>> 0), 38); // external attributes: regular file, 0644
  central.writeUInt32LE(0, 42); // local header offset

  const centralSize = central.length + fileName.length;
  const centralOffset = local.length + fileName.length + packed.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);

  return Buffer.concat([local, fileName, packed, central, fileName, end]);
}

function npm(...args: string[]): void {
  // npm is a .cmd shim on Windows, which Node can only start through cmd.exe. Arguments here are fixed literals.
  const windows = process.platform === 'win32';
  const result = spawnSync(windows ? 'cmd.exe' : 'npm', windows ? ['/d', '/s', '/c', 'npm', ...args] : args, { cwd: ROOT, stdio: 'inherit' });
  if (result.error) throw new Error('Node.js 22 with npm must be on PATH to package the Lambdas.');
  if (result.status !== 0) throw new Error(`npm ${args.join(' ')} failed with exit code ${result.status}`);
}

/** Install if needed, then bundle the shared library and both handlers. */
function build(): void {
  if (!existsSync(path.join(ROOT, 'node_modules'))) npm('ci', '--no-audit', '--no-fund');
  npm('run', 'build', '-w', '@habitloop/shared');
  for (const name of FUNCTIONS) npm('run', 'build', '-w', `@habitloop/${name}`);
}

function packageFunction(name: string, output: string): void {
  const bundle = path.join(ROOT, 'lambdas', name, 'dist', 'handler.js');
  if (!existsSync(bundle) || !statSync(bundle).isFile()) {
    throw new Error(`Missing ${bundle}; the esbuild step did not produce it.`);
  }
  // Replace only this function's prior build, atomically and without stale copies.
  const pending = `${output}.part`;
  try {
    writeFileSync(pending, zipSingleFile('handler.js', readFileSync(bundle)));
    renameSync(pending, output);
  } finally {
    rmSync(pending, { force: true });
  }
}

function main(): number {
  try {
    console.log('[1 of 3] Building the shared library and Lambda bundles');
    build();
    FUNCTIONS.forEach((name, index) => {
      console.log(`[${index + 2} of 3] Packaging ${name} for Node.js 22`);
      packageFunction(name, path.join(ROOT, `${name}.zip`));
    });
    console.log('Lambda packages ready in the project root.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
