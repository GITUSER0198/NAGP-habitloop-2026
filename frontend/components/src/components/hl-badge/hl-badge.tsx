import { Component, h, Prop } from '@stencil/core';
import { formatDateTime, nonNegative } from '../../utils/format';

@Component({ tag: 'hl-badge', styleUrl: '../../styles/component.css', shadow: true })
export class HlBadge {
  @Prop() days = 0;
  @Prop() earned = false;
  @Prop() earnedAt?: string;
  @Prop() remaining = 0;

  render() {
    return <article class={`card badge-card ${this.earned ? '' : 'locked'}`}>
      <div class="card-head"><span class="icon-tile" aria-hidden="true">{this.earned ? '★' : '☆'}</span>
        <h2>{nonNegative(this.days)} day milestone</h2></div>
      <p class={this.earned ? 'accent' : 'muted'}><strong>{this.earned ? 'Earned' : 'Locked'}</strong></p>
      {this.earned ? <p>Earned: {formatDateTime(this.earnedAt)}</p> : <p>{nonNegative(this.remaining)} days remaining</p>}
    </article>;
  }
}
