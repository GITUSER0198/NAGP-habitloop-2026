import { newSpecPage } from '@stencil/core/testing';
import { HlBadge } from './hl-badge';

describe('hl-badge', () => {
  it('renders a locked milestone with days remaining', async () => {
    const page = await newSpecPage({ components: [HlBadge], html: '<hl-badge days="30" remaining="12"></hl-badge>' });
    expect(page.root!.shadowRoot!.textContent).toContain('30 day milestone');
    expect(page.root!.shadowRoot!.textContent).toContain('Locked');
    expect(page.root!.shadowRoot!.textContent).toContain('12 days remaining');
    expect(page.root!.shadowRoot!.querySelector('.locked')).not.toBeNull();
  });

  it('renders the earned state and date using AM/PM', async () => {
    const page = await newSpecPage({ components: [HlBadge], html: '<hl-badge days="7" earned earned-at="2026-11-19T07:30:00"></hl-badge>' });
    expect(page.root!.shadowRoot!.textContent).toContain('Earned');
    expect(page.root!.shadowRoot!.textContent).toContain('7:30 AM');
    expect(page.root!.shadowRoot!.querySelector('.locked')).toBeNull();
  });
});
