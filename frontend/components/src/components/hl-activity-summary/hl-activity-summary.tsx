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
    return <article class="card" aria-busy={String(this.busy)}>
      <div class="row"><h2><i class={`ti ${icon}`} aria-hidden="true" /> {this.name || 'Untitled activity'}</h2>
        <span>{knownCategory ? this.category : 'other'}</span></div>
      <p class="muted">{formatTime(this.preferredTime)}</p>
      <p>Status: <strong>{this.status}</strong></p>
      <p class="accent">{nonNegative(this.streak)} day streak</p>
      <div class="actions">{['done', 'completed', 'missed'].map(status =>
        <Action label={status === 'done' ? 'Log done' : status === 'completed' ? 'Log completed' : 'Log missed'}
          busy={this.busy} secondary={status !== 'completed'} onClick={() => this.hlLog.emit({ status })} />)}</div>
    </article>;
  }
}
