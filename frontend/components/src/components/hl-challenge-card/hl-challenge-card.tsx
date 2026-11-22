import { Component, Event, EventEmitter, h, Prop } from '@stencil/core';
import { nonNegative, percentage } from '../../utils/format';
import { Action } from '../../utils/ui';

@Component({ tag: 'hl-challenge-card', styleUrl: '../../styles/component.css', shadow: true })
export class HlChallengeCard {
  @Prop() title = '';
  @Prop() visibility = 'public';
  @Prop() participants = 0;
  @Prop() progress = 0;
  @Prop() target = 0;
  @Prop() joined = false;
  @Prop() owner = false;
  @Prop() invited = false;
  @Prop() busy = false;
  @Event({ bubbles: true, composed: true }) hlJoin!: EventEmitter<void>;
  @Event({ bubbles: true, composed: true }) hlAccept!: EventEmitter<void>;
  @Event({ bubbles: true, composed: true }) hlDecline!: EventEmitter<void>;

  render() {
    const progress = nonNegative(this.progress), target = nonNegative(this.target);
    return <article class="card interactive" aria-busy={String(this.busy)}>
      <div class="card-head"><span class="icon-tile" aria-hidden="true">{'\u2691'}</span>
        <h2>{this.title || 'Challenge'}</h2><span class="chip tonal">{this.visibility}</span></div>
      <p class="muted">{nonNegative(this.participants)} {nonNegative(this.participants) === 1 ? 'participant' : 'participants'}</p>
      <p>{progress} of {target} completed</p>
      <div class="meter" role="progressbar" aria-label="Challenge progress" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={percentage(progress, target)} aria-valuetext={`${progress} of ${target}`}>
        <span style={{ width: `${percentage(progress, target)}%` }} /></div>
      {this.owner ? <p class="accent"><strong>Your challenge</strong></p> : this.joined ? <p class="accent"><strong>Joined</strong></p> : <div class="actions">
        {this.invited ? [
          <Action label="Accept invitation" busy={this.busy} onClick={() => this.hlAccept.emit()} />,
          <Action label="Decline invitation" busy={this.busy} variant="outlined" onClick={() => this.hlDecline.emit()} />,
        ] : <Action label="Join challenge" busy={this.busy} onClick={() => this.hlJoin.emit()} />}
      </div>}
    </article>;
  }
}
