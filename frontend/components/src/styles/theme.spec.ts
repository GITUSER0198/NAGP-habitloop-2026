import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function luminance(hex: string): number {
  const channels = hex.slice(1).match(/../g)!.map(channel => parseInt(channel, 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(first: string, second: string): number {
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('Midnight WCAG AA text contrast', () => {
  const css = readFileSync(resolve(process.cwd(), '../theme/tokens.css'), 'utf8');
  const modes = [...css.matchAll(/(?:^|\n)(:root|\[data-mode="light"\])\s*\{([^}]+)\}/g)];

  it('defines both modes with exactly the contracted token names', () => {
    expect(modes).toHaveLength(2);
    for (const mode of modes) {
      const names = [...mode[2].matchAll(/(--hl-[\w-]+):/g)].map(match => match[1]).sort();
      const contracted = ['bg', 'surface', 'surface-2', 'text', 'text-muted', 'accent',
        'accent-contrast', 'danger', 'warning', 'border', 'radius', 'font'].map(name => `--hl-${name}`);
      const material = ['elev-1', 'elev-2', 'elev-3', 'elev-4', 'radius-card', 'radius-pill', 'surface-container',
        'surface-container-high', 'surface-container-highest', 'accent-container', 'on-accent-container',
        'bg-image-login', 'bg-image-hero', 'bg-beams', 'motion-fast', 'motion', 'motion-slow', 'ease'].map(name => `--hl-${name}`);
      for (const name of [...contracted, ...material]) expect(names).toContain(name);
    }
  });

  for (const mode of modes) {
    it(`${mode[1]} text passes 4.5:1 on every surface used`, () => {
      const tokens = Object.fromEntries([...mode[2].matchAll(/--hl-([\w-]+):\s*([^;]+);/g)].map(match => [match[1], match[2]]));
      for (const surface of ['bg', 'surface', 'surface-2']) {
        expect(contrast(tokens.text, tokens[surface])).toBeGreaterThanOrEqual(4.5);
      }
      for (const surface of ['bg', 'surface']) {
        for (const foreground of ['text-muted', 'accent', 'danger', 'warning']) {
          expect(contrast(tokens[foreground], tokens[surface])).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(contrast(tokens['accent-contrast'], tokens.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens['on-accent-container'], tokens['accent-container'])).toBeGreaterThanOrEqual(4.5);
      for (const surface of ['surface-container', 'surface-container-high']) {
        expect(contrast(tokens.text, tokens[surface])).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});
