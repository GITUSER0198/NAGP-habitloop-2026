import { Component, Element, Event, EventEmitter, h, Prop } from '@stencil/core';
import { JsonArray, parseArray, record, ReminderItem } from '../../utils/data';
import { formatDateTime } from '../../utils/format';
import { Action, Details } from '../../utils/ui';

@Component({ tag: 'hl-reminder-banner', styleUrl: '../../styles/component.css', shadow: true })
export class HlReminderBanner {
  @Element() host!: HTMLElement;
  @Prop() items: JsonArray<ReminderItem> = [];
  @Prop() busy = false;
  @Event({ bubbles: true, composed: true }) hlLogNow!: EventEmitter<{ activityId: string }>;
  @Event({ bubbles: true, composed: true }) hlSnooze!: EventEmitter<{ activityId: string }>;

  render() {
    const items = parseArray(this.items).filter(record).filter(item => typeof item.activityId === 'string'
      && typeof item.name === 'string' && typeof item.dueAt === 'string') as unknown as ReminderItem[];
    const list = (visible: ReminderItem[]) => <ul>{visible.map(item => <li>
      <strong>{item.name}</strong><p class="muted">Due: {formatDateTime(item.dueAt)}</p>
      <div class="actions"><Action label="Log now" busy={this.busy} onClick={() => this.hlLogNow.emit({ activityId: item.activityId })} />
        <Action label="Snooze" busy={this.busy} secondary onClick={() => this.hlSnooze.emit({ activityId: item.activityId })} /></div>
    </li>)}</ul>;
    return <section class="card" aria-busy={String(this.busy)} aria-label="Activity reminders">
      <h2>Reminders ({items.length})</h2>
      {!items.length ? <p class="empty" role="status">You're all caught up</p> : list(items.slice(0, 3))}
      {items.length > 3 && <Details host={this.host} summary={`More reminders (${items.length - 3})`}>{list(items.slice(3))}</Details>}
    </section>;
  }
}
