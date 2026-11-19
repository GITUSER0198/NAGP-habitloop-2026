import { newSpecPage } from '@stencil/core/testing';
import { HlPartnerTile } from '../components/hl-partner-tile/hl-partner-tile';

describe('persisted secondary details', () => {
  it('reads and writes disclosure state using the component id', async () => {
    const page = await newSpecPage({ components: [HlPartnerTile], html: '<hl-partner-tile id="partner-a"></hl-partner-tile>' });
    const get = jest.spyOn(window.localStorage, 'getItem').mockReturnValue('true');
    const set = jest.spyOn(window.localStorage, 'setItem').mockImplementation(() => undefined);
    page.root!.provider = 'MockFit'; await page.waitForChanges();
    const details = page.root!.shadowRoot!.querySelector('details')!;
    expect(details.hasAttribute('open')).toBe(true);
    expect(get).toHaveBeenCalledWith('habitloop:details:partner-a');
    details.open = false;
    details.dispatchEvent(new Event('toggle'));
    expect(set).toHaveBeenCalledWith('habitloop:details:partner-a', 'false');
    get.mockRestore(); set.mockRestore();
  });

  it('survives blocked storage and defaults closed', async () => {
    const page = await newSpecPage({ components: [HlPartnerTile], html: '<hl-partner-tile id="blocked"></hl-partner-tile>' });
    const get = jest.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = jest.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    page.root!.provider = 'MockRun'; await page.waitForChanges();
    const details = page.root!.shadowRoot!.querySelector('details')!;
    expect(details.hasAttribute('open')).toBe(false);
    expect(() => { details.open = true; details.dispatchEvent(new Event('toggle')); }).not.toThrow();
    get.mockRestore(); set.mockRestore();
  });

  it('does not persist unidentified instances', async () => {
    const page = await newSpecPage({ components: [HlPartnerTile], html: '<hl-partner-tile></hl-partner-tile>' });
    const set = jest.spyOn(window.localStorage, 'setItem').mockImplementation(() => undefined);
    const details = page.root!.shadowRoot!.querySelector('details')!;
    details.open = true; details.dispatchEvent(new Event('toggle'));
    expect(set).not.toHaveBeenCalled();
    set.mockRestore();
  });
});
