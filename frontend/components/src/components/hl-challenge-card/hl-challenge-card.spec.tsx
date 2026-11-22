import { newSpecPage } from '@stencil/core/testing';
import { HlChallengeCard } from './hl-challenge-card';

describe('hl-challenge-card', () => {
  it('emits join and clamps progress', async () => {
    const page = await newSpecPage({ components: [HlChallengeCard], html: '<hl-challenge-card title="Walking" progress="12" target="10" participants="3"></hl-challenge-card>' });
    const join = jest.fn();
    page.root!.addEventListener('hlJoin', join);
    page.root!.shadowRoot!.querySelector('button')!.click();
    expect(join).toHaveBeenCalledTimes(1);
    expect(page.root!.shadowRoot!.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('100');
    expect(page.root!.shadowRoot!.textContent).toContain('Walking');
    expect(page.root!.shadowRoot!.textContent).toContain('3 participants');
  });

  it('supports invitations, joined state, members visibility, owner badge and zero targets', async () => {
    const page = await newSpecPage({ components: [HlChallengeCard], html: '<hl-challenge-card invited visibility="members"></hl-challenge-card>' });
    const accept = jest.fn(), decline = jest.fn();
    page.root!.addEventListener('hlAccept', accept);
    page.root!.addEventListener('hlDecline', decline);
    const buttons = page.root!.shadowRoot!.querySelectorAll('button');
    buttons[0].click(); buttons[1].click();
    expect(accept).toHaveBeenCalledTimes(1); expect(decline).toHaveBeenCalledTimes(1);
    expect(page.root!.shadowRoot!.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('0');
    page.root!.joined = true;
    await page.waitForChanges();
    expect(page.root!.shadowRoot!.textContent).toContain('Joined');
    expect(page.root!.shadowRoot!.querySelector('button')).toBeNull();
    page.root!.joined = false; page.root!.invited = false;
    await page.waitForChanges();
    expect(page.root!.shadowRoot!.querySelector('button')).not.toBeNull();
    page.root!.owner = true;
    await page.waitForChanges();
    expect(page.root!.shadowRoot!.textContent).toContain('Your challenge');
    expect(page.root!.shadowRoot!.querySelector('button')).toBeNull();
  });

  it('blocks both invite actions while busy', async () => {
    const page = await newSpecPage({ components: [HlChallengeCard], html: '<hl-challenge-card invited busy></hl-challenge-card>' });
    const accept = jest.fn(); page.root!.addEventListener('hlAccept', accept);
    page.root!.shadowRoot!.querySelectorAll('button').forEach(button => { expect(button.hasAttribute('disabled')).toBe(true); button.click(); });
    expect(accept).not.toHaveBeenCalled();
  });
});
