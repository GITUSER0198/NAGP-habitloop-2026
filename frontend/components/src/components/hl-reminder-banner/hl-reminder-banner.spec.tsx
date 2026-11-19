import { newSpecPage } from '@stencil/core/testing';
import { HlReminderBanner } from './hl-reminder-banner';

describe('hl-reminder-banner', () => {
  it('shows an empty state', async () => {
    const page = await newSpecPage({ components: [HlReminderBanner], html: '<hl-reminder-banner></hl-reminder-banner>' });
    expect(page.root!.shadowRoot!.textContent).toContain("You're all caught up");
  });

  it('emits activity IDs, formats due times, and collapses long lists', async () => {
    const page = await newSpecPage({ components: [HlReminderBanner], html: '<hl-reminder-banner></hl-reminder-banner>' });
    page.root!.items = JSON.stringify(Array.from({ length: 4 }, (_, index) => ({ activityId: `a${index}`, name: `Activity ${index}`, dueAt: '21:00' })));
    await page.waitForChanges();
    const log = jest.fn(), snooze = jest.fn();
    page.root!.addEventListener('hlLogNow', log); page.root!.addEventListener('hlSnooze', snooze);
    const buttons = page.root!.shadowRoot!.querySelectorAll('button');
    buttons[0].click(); buttons[1].click();
    expect((log.mock.calls[0][0] as CustomEvent).detail).toEqual({ activityId: 'a0' });
    expect((snooze.mock.calls[0][0] as CustomEvent).detail).toEqual({ activityId: 'a0' });
    expect(page.root!.shadowRoot!.textContent).toContain('9:00 PM');
    expect(page.root!.shadowRoot!.querySelector('details')!.hasAttribute('open')).toBe(false);
    page.root!.busy = true; await page.waitForChanges();
    page.root!.shadowRoot!.querySelectorAll('button').forEach(button => expect(button.hasAttribute('disabled')).toBe(true));
  });
});
