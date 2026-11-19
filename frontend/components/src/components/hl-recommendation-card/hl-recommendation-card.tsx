import { Component, Element, Event, EventEmitter, h, Prop } from '@stencil/core';
import { formatTime, nonNegative } from '../../utils/format';
import { Action, Details } from '../../utils/ui';

@Component({ tag: 'hl-recommendation-card', styleUrl: '../../styles/component.css', shadow: true })
export class HlRecommendationCard {
  @Element() host!: HTMLElement;
  @Prop() kind = 'timing';
  @Prop() current = '';
  @Prop() suggested = '';
  @Prop() reason = '';
  @Prop() confidence = 0;
  @Prop() status = 'pending';
  @Prop() busy = false;
  @Event({ bubbles: true, composed: true }) hlAccept!: EventEmitter<void>;
  @Event({ bubbles: true, composed: true }) hlDismiss!: EventEmitter<void>;

  render() {
    const timing = this.kind === 'timing';
    return <article class="card" aria-busy={String(this.busy)}><h2>{timing ? 'Try a new time' : 'Adjust your frequency'}</h2>
      <p>Current: <strong>{timing ? formatTime(this.current) : this.current}</strong></p>
      <p>Suggested: <strong class="accent">{timing ? formatTime(this.suggested) : this.suggested}</strong></p>
      <p>Status: {this.status}</p>
      <Details host={this.host} summary="Why this suggestion?">
        <p>{this.reason || 'No additional details'}</p>
        <p class="muted">Confidence: {Math.round(Math.min(1, nonNegative(this.confidence)) * 100)}%</p>
      </Details>
      {this.status === 'pending' && <div class="actions">
        <Action label="Accept suggestion" busy={this.busy} onClick={() => this.hlAccept.emit()} />
        <Action label="Dismiss" busy={this.busy} secondary onClick={() => this.hlDismiss.emit()} />
      </div>}
    </article>;
  }
}
