import { Component, Event, EventEmitter, h, Prop } from '@stencil/core';
import categories from '../../../../../config/categories.json';
import { formatTime, nonNegative } from '../../utils/format';
import { Action } from '../../utils/ui';

@Component({ tag: 'hl-activity-summary', styleUrls: ['../../styles/component.css', 'hl-activity-summary.css'], shadow: true })
export class HlActivitySummary {
  @Prop() name = '';
  @Prop() category = 'other';
  @Prop() preferredTime?: string;
  @Prop() status = 'Not logged';
  @Prop() streak = 0;
  @Prop() busy = false;
  @Event({ bubbles: true, composed: true }) hlLog!: EventEmitter<{ status: string }>;

  render() {
    const knownCategory = Object.hasOwn(categories, this.category);
    const icon = knownCategory ? categories[this.category as keyof typeof categories] : categories.other;
    const logged = this.status !== 'Not logged';
    return <article class="card interactive" aria-busy={String(this.busy)}>
      <div class="card-head"><span class="icon-tile"><i class={`ti ${icon}`} aria-hidden="true" /></span>
        <h2>{this.name || 'Untitled activity'}</h2>
        <span class="chip tonal">{knownCategory ? this.category : 'other'}</span></div>
      <div class="chips">
        <span class="chip">{formatTime(this.preferredTime)}</span>
        <span class={logged ? 'chip tonal' : 'chip'}>Status: <strong>{this.status}</strong></span>
        <span class="chip">{nonNegative(this.streak)} day streak</span>
      </div>
      <div class="actions">{['done', 'completed', 'missed'].map(status =>
        <Action label={status === 'done' ? 'Log done' : status === 'completed' ? 'Log completed' : 'Log missed'}
          busy={this.busy} variant={status === 'completed' ? 'filled' : status === 'done' ? 'tonal' : 'outlined'}
          onClick={() => this.hlLog.emit({ status })} />)}</div>
    </article>;
  }
}
