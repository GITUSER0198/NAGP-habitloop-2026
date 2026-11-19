import { newSpecPage } from '@stencil/core/testing';
import { HlPartnerTile } from './hl-partner-tile';

describe('hl-partner-tile', () => {
  it('emits connect and disconnect based on props', async () => {
    const page = await newSpecPage({ components: [HlPartnerTile], html: '<hl-partner-tile provider="MockFit" last-event-at="2026-11-19T21:30:00" rejected-count="2"></hl-partner-tile>' });
    const connect = jest.fn(), disconnect = jest.fn();
    page.root!.addEventListener('hlConnect', connect); page.root!.addEventListener('hlDisconnect', disconnect);
    page.root!.shadowRoot!.querySelector('button')!.click();
    expect(connect).toHaveBeenCalledTimes(1);
    page.root!.linked = true; await page.waitForChanges();
    page.root!.shadowRoot!.querySelector('button')!.click();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(page.root!.shadowRoot!.textContent).toContain('9:30 PM');
    expect(page.root!.shadowRoot!.textContent).toContain('2 rejected events');
    expect(page.root!.shadowRoot!.querySelector('details')!.hasAttribute('open')).toBe(false);
  });

  it('shows a disabled button and spinner while busy', async () => {
    const page = await newSpecPage({ components: [HlPartnerTile], html: '<hl-partner-tile busy></hl-partner-tile>' });
    expect(page.root!.shadowRoot!.querySelector('button')!.hasAttribute('disabled')).toBe(true);
    expect(page.root!.shadowRoot!.querySelector('.spinner')).not.toBeNull();
  });
});
