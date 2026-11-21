import { Component, Element, h, Prop } from '@stencil/core';
import { JsonArray, LeaderboardRow, parseArray, record } from '../../utils/data';
import { nonNegative } from '../../utils/format';
import { Details } from '../../utils/ui';

@Component({ tag: 'hl-leaderboard', styleUrl: '../../styles/component.css', shadow: true })
export class HlLeaderboard {
  @Element() host!: HTMLElement;
  @Prop() rows: JsonArray<LeaderboardRow> = [];

  render() {
    const rows = parseArray(this.rows).filter(record).filter(row => typeof row.name === 'string');
    const table = (visible: typeof rows, offset = 0) => <div class="scroll"><table>
      <thead><tr><th scope="col">Rank</th><th scope="col">Name</th><th scope="col">Count</th><th scope="col">Target</th></tr></thead>
      <tbody>{visible.map((row, index) => <tr class={row.isMe === true ? 'me' : ''} aria-current={row.isMe === true ? 'true' : undefined}>
        <td>{offset + index + 1}</td><td>{String(row.name)}{row.isMe === true ? ' (you)' : ''}</td>
        <td>{nonNegative(row.count)}</td><td>{nonNegative(row.target)}</td></tr>)}</tbody>
    </table></div>;
    return <section class="card"><div class="card-head"><span class="icon-tile" aria-hidden="true">{'♔'}</span><h2>Leaderboard</h2></div>
      {!rows.length ? <p class="empty" role="status">No participants yet</p> : table(rows.slice(0, 5))}
      {rows.length > 5 && <Details host={this.host} summary={`More participants (${rows.length - 5})`}>{table(rows.slice(5), 5)}</Details>}
    </section>;
  }
}
