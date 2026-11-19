import { newSpecPage } from '@stencil/core/testing';
import { HlActivitySummary } from './hl-activity-summary';

describe('hl-activity-summary', () => {
  it('shows the configured icon, a 12-hour schedule, status, and streak', async () => {
    const page = await newSpecPage({ components: [HlActivitySummary], html: '<hl-activity-summary name="Run" category="fitness" preferred-time="21:30" status="completed" streak="7"></hl-activity-summary>' });
    expect(page.root!.shadowRoot!.textContent).toContain('9:30 PM');
    expect(page.root!.shadowRoot!.textContent).toContain('7 day streak');
    expect(page.root!.shadowRoot!.textContent).toContain('completed');
    expect(page.root!.shadowRoot!.querySelector('.ti-run')).not.toBeNull();
  });

  it.each(['unknown', '__proto__', 'constructor'])('falls back for unknown category %s and missing schedule', async category => {
    const page = await newSpecPage({ components: [HlActivitySummary], html: `<hl-activity-summary category="${category}"></hl-activity-summary>` });
    expect(page.root!.shadowRoot!.textContent).toContain('Any time');
    expect(page.root!.shadowRoot!.querySelector('.ti-circle-dot')).not.toBeNull();
  });

  it('emits each log status across the shadow boundary and disables actions while busy', async () => {
    const page = await newSpecPage({ components: [HlActivitySummary], html: '<hl-activity-summary></hl-activity-summary>' });
    const received: CustomEvent[] = [];
    page.root!.addEventListener('hlLog', event => received.push(event as CustomEvent));
    const buttons = page.root!.shadowRoot!.querySelectorAll('button');
    buttons.forEach(button => button.click());
    expect(received.map(event => event.detail)).toEqual([{ status: 'done' }, { status: 'completed' }, { status: 'missed' }]);
    expect(received.every(event => event.bubbles && event.composed)).toBe(true);
    page.root!.busy = true;
    await page.waitForChanges();
    page.root!.shadowRoot!.querySelectorAll('button').forEach(button => {
      expect(button.hasAttribute('disabled')).toBe(true);
      button.click();
    });
    expect(received).toHaveLength(3);
    expect(page.root!.shadowRoot!.querySelector('.spinner')).not.toBeNull();
  });
});
