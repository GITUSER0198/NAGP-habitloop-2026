import { newSpecPage } from '@stencil/core/testing';
import { HlRecommendationCard } from './hl-recommendation-card';

describe('hl-recommendation-card', () => {
  it('formats times, emits accept/dismiss, and collapses the reason', async () => {
    const page = await newSpecPage({ components: [HlRecommendationCard], html: '<hl-recommendation-card current="20:00" suggested="07:00" reason="Morning works better" confidence="0.85"></hl-recommendation-card>' });
    const accept = jest.fn(), dismiss = jest.fn();
    page.root!.addEventListener('hlAccept', accept); page.root!.addEventListener('hlDismiss', dismiss);
    const buttons = page.root!.shadowRoot!.querySelectorAll('button');
    buttons[0].click(); buttons[1].click();
    expect(accept).toHaveBeenCalledTimes(1); expect(dismiss).toHaveBeenCalledTimes(1);
    expect(page.root!.shadowRoot!.textContent).toContain('8:00 PM');
    expect(page.root!.shadowRoot!.textContent).toContain('7:00 AM');
    expect(page.root!.shadowRoot!.textContent).toContain('85%');
    expect(page.root!.shadowRoot!.querySelector('details')!.hasAttribute('open')).toBe(false);
  });

  it('blocks busy actions and removes them once handled', async () => {
    const page = await newSpecPage({ components: [HlRecommendationCard], html: '<hl-recommendation-card kind="frequency" current="3" suggested="5" busy></hl-recommendation-card>' });
    expect(page.root!.shadowRoot!.textContent).toContain('Suggested: 5');
    page.root!.shadowRoot!.querySelectorAll('button').forEach(button => expect(button.hasAttribute('disabled')).toBe(true));
    for (const status of ['accepted', 'dismissed', 'no longer applies']) {
      page.root!.status = status; await page.waitForChanges();
      expect(page.root!.shadowRoot!.querySelector('button')).toBeNull();
      expect(page.root!.shadowRoot!.textContent).toContain(status);
    }
  });
});
