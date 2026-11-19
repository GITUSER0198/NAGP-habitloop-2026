import { newSpecPage } from '@stencil/core/testing';
import { HlHeatmap } from './hl-heatmap';

describe('hl-heatmap', () => {
  it.each(['', '[]', '{bad', '{}', 'null', '[null]', '[{"date":"2026-02-30","done":1,"completed":0,"missed":0}]', '[{"date":"2026-11-19","done":-1,"completed":0,"missed":0}]'])('handles empty or malformed input: %s', async data => {
    const page = await newSpecPage({ components: [HlHeatmap], html: '<hl-heatmap></hl-heatmap>' });
    page.root!.data = data; await page.waitForChanges();
    expect(page.root!.shadowRoot!.textContent).toContain('No heatmap data');
  });

  it('renders 365 aligned dates, five scale steps, and tooltips including missed counts', async () => {
    const page = await newSpecPage({ components: [HlHeatmap], html: '<hl-heatmap></hl-heatmap>' });
    page.root!.data = [0, 1, 2, 3, 4].map((done, index) => ({ date: `2026-11-${15 + index}`, done, completed: 0, missed: 2 }));
    await page.waitForChanges();
    const cells = page.root!.shadowRoot!.querySelectorAll('.heatmap .cell');
    expect(cells).toHaveLength(365);
    expect(page.root!.shadowRoot!.querySelectorAll('.legend .cell')).toHaveLength(5);
    for (const level of [0, 1, 2, 3, 4]) expect(page.root!.shadowRoot!.querySelector(`.heatmap .level-${level}`)).not.toBeNull();
    const last = cells[cells.length - 1] as HTMLElement;
    expect(last.getAttribute('title')).toBe('2026-11-19: 4 done, 0 completed, 2 missed');
    last.dispatchEvent(new Event('focus')); await page.waitForChanges();
    expect(page.root!.shadowRoot!.querySelector('.tooltip')!.textContent).toContain('2026-11-19: 4 done, 0 completed, 2 missed');
    expect(cells[0].getAttribute('title')).toContain('2025-11-20');
    expect(page.root!.shadowRoot!.querySelector('.heatmap')!.firstElementChild!.hasAttribute('aria-hidden')).toBe(true);
  });

  it('deduplicates dates and handles leap years, unsorted rows, and large old counts', async () => {
    const page = await newSpecPage({ components: [HlHeatmap], html: '<hl-heatmap></hl-heatmap>' });
    page.root!.data = JSON.stringify([
      { date: '2024-03-01', done: 1, completed: 1, missed: 0 },
      { date: '2020-01-01', done: 10000, completed: 0, missed: 0 },
      { date: '2024-02-29', done: 1, completed: 0, missed: 0 },
      { date: '2024-03-01', done: 4, completed: 0, missed: 0 },
    ]);
    await page.waitForChanges();
    expect(page.root!.shadowRoot!.querySelectorAll('.heatmap .cell')).toHaveLength(365);
    expect(page.root!.shadowRoot!.querySelector('[title^="2024-02-29"]')).not.toBeNull();
    expect(page.root!.shadowRoot!.querySelector('[title^="2024-03-01"]')!.className).toContain('level-4');
  });
});
