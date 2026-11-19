import { newSpecPage } from '@stencil/core/testing';
import { HlLeaderboard } from './hl-leaderboard';

describe('hl-leaderboard', () => {
  it('shows empty state for missing or malformed rows', async () => {
    const page = await newSpecPage({ components: [HlLeaderboard], html: '<hl-leaderboard rows="bad"></hl-leaderboard>' });
    expect(page.root!.shadowRoot!.textContent).toContain('No participants yet');
  });

  it('highlights the current user, keeps input order, and collapses secondary rows', async () => {
    const page = await newSpecPage({ components: [HlLeaderboard], html: '<hl-leaderboard></hl-leaderboard>' });
    page.root!.rows = Array.from({ length: 7 }, (_, index) => ({ name: `Person ${index}`, count: 10 - index, target: 30, isMe: index === 1 }));
    await page.waitForChanges();
    expect(page.root!.shadowRoot!.querySelector('tr.me')!.textContent).toContain('Person 1 (you)');
    expect(page.root!.shadowRoot!.querySelector('tr.me')!.getAttribute('aria-current')).toBe('true');
    expect(page.root!.shadowRoot!.querySelectorAll('tbody tr')).toHaveLength(7);
    expect(page.root!.shadowRoot!.querySelector('details')!.hasAttribute('open')).toBe(false);
    expect(page.root!.shadowRoot!.querySelector('summary')!.textContent).toBe('More participants (2)');
  });
});
