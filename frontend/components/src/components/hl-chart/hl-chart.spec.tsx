import { newSpecPage } from '@stencil/core/testing';
import { HlChart } from './hl-chart';

describe('hl-chart', () => {
  it.each([undefined, '', '[]', '{bad', '{}', 'null', '[null]', '[{"value":"bad"}]', '[1,-2]'])('handles empty or malformed input: %s', async data => {
    const page = await newSpecPage({ components: [HlChart], html: '<hl-chart></hl-chart>' });
    page.root!.data = data;
    await page.waitForChanges();
    expect(page.root!.shadowRoot!.textContent).toContain('No chart data');
    expect(page.root!.shadowRoot!.querySelector('svg')).toBeNull();
  });

  it('renders trend points, including a single point and all-zero data', async () => {
    const page = await newSpecPage({ components: [HlChart], html: '<hl-chart data="[0]"></hl-chart>' });
    expect(page.root!.shadowRoot!.querySelectorAll('circle')).toHaveLength(1);
    expect(page.root!.shadowRoot!.querySelector('circle')!.getAttribute('cx')).toBe('320');
    expect(page.root!.shadowRoot!.querySelector('svg')!.outerHTML).not.toMatch(/NaN|Infinity/);
    expect(page.root!.shadowRoot!.querySelector('details')!.hasAttribute('open')).toBe(false);
  });

  it('renders a pure SVG bar chart and accessible data table from array props', async () => {
    const page = await newSpecPage({ components: [HlChart], html: '<hl-chart type="bar"></hl-chart>' });
    page.root!.data = [{ label: 'Mon', value: 2 }, { label: 'Tue', value: 4 }];
    await page.waitForChanges();
    expect(page.root!.shadowRoot!.querySelectorAll('svg rect')).toHaveLength(2);
    expect(page.root!.shadowRoot!.querySelector('canvas')).toBeNull();
    expect(page.root!.shadowRoot!.querySelector('table')!.textContent).toContain('Mon2');
  });
});
