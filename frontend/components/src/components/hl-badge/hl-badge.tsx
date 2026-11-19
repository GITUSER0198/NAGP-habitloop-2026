import { Component, h, Prop } from '@stencil/core';
import { formatDateTime, nonNegative } from '../../utils/format';

@Component({ tag: 'hl-badge', styleUrl: '../../styles/component.css', shadow: true })
export class HlBadge {
  @Prop() days = 0;
  @Prop() earned = false;
  @Prop() earnedAt?: string;
  @Prop() remaining = 0;

  render() {
    return <article class={`card ${this.earned ? '' : 'locked'}`}>
      <h2>{nonNegative(this.days)} day milestone</h2>
      <p class={this.earned ? 'accent' : 'muted'}>{this.earned ? 'Earned' : 'Locked'}</p>
      {this.earned ? <p>Earned: {formatDateTime(this.earnedAt)}</p> : <p>{nonNegative(this.remaining)} days remaining</p>}
    </article>;
  }
}
