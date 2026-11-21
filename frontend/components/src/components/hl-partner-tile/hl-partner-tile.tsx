import { Component, Element, Event, EventEmitter, h, Prop } from '@stencil/core';
import { formatDateTime, nonNegative } from '../../utils/format';
import { Action, Details } from '../../utils/ui';

@Component({ tag: 'hl-partner-tile', styleUrl: '../../styles/component.css', shadow: true })
export class HlPartnerTile {
  @Element() host!: HTMLElement;
  @Prop() provider = '';
  @Prop() linked = false;
  @Prop() lastEventAt?: string;
  @Prop() rejectedCount = 0;
  @Prop() busy = false;
  @Event({ bubbles: true, composed: true }) hlConnect!: EventEmitter<void>;
  @Event({ bubbles: true, composed: true }) hlDisconnect!: EventEmitter<void>;

  render() {
    return <article class="card interactive" aria-busy={String(this.busy)}>
      <div class="card-head"><span class="icon-tile" aria-hidden="true">{'⌁'}</span><h2>{this.provider || 'Partner'}</h2><span class={this.linked ? 'chip tonal' : 'chip'}>{this.linked ? 'Connected' : 'Not connected'}</span></div>
      <Details host={this.host} summary={`Event details (${nonNegative(this.rejectedCount)} rejected)`}>
        <p>Last event: {formatDateTime(this.lastEventAt)}</p>
        <p class={this.rejectedCount > 0 ? 'danger' : 'muted'}>{nonNegative(this.rejectedCount)} rejected events</p>
      </Details>
      <div class="actions"><Action label={this.linked ? 'Disconnect' : 'Connect'} busy={this.busy}
        variant={this.linked ? 'outlined' : 'filled'} onClick={() => this.linked ? this.hlDisconnect.emit() : this.hlConnect.emit()} /></div>
    </article>;
  }
}
