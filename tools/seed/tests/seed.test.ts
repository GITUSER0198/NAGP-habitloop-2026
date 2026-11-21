import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setting } from '../src/seed.js';

const dirs: string[] = [];
function project(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'habitloop-seed-'));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
  return dir;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

describe('setting', () => {
  it('prefers the environment over files', () => {
    const root = project({ '.env': 'DEMO_PASSWORD=from-file\n' });
    expect(setting('DEMO_PASSWORD', { DEMO_PASSWORD: 'from-env' }, root)).toBe('from-env');
  });
  it('reads .env, strips quotes and CRLF, and ignores other keys', () => {
    const root = project({ '.env': 'OTHER=1\r\nDEMO_PASSWORD="quoted value"\r\n' });
    expect(setting('DEMO_PASSWORD', {}, root)).toBe('quoted value');
  });
  it('falls back to .env.example', () => {
    const root = project({ '.env.example': 'DEMO_PASSWORD=example-value\n' });
    expect(setting('DEMO_PASSWORD', {}, root)).toBe('example-value');
  });
  it('fails clearly when the setting is missing', () => {
    expect(() => setting('DEMO_PASSWORD', {}, project({}))).toThrow('Set DEMO_PASSWORD');
  });
});
