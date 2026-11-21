import { Component, h, Prop, State } from '@stencil/core';
import { HeatmapDay, heatmapDays, JsonArray, yearGrid } from '../../utils/data';

function description(day: HeatmapDay): string {
  return `${day.date}: ${day.done} done, ${day.completed} completed, ${day.missed} missed`;
}

@Component({ tag: 'hl-heatmap', styleUrl: '../../styles/component.css', shadow: true })
export class HlHeatmap {
  @Prop() data: JsonArray<HeatmapDay> = [];
  @State() active?: HeatmapDay;

  render() {
    const days = heatmapDays(this.data), cells = yearGrid(days);
    if (!days.length) return <section class="card"><h2>Activity year</h2><p class="empty" role="status">No heatmap data</p></section>;
    const maximum = Math.max(1, ...cells.map(day => day ? day.done + day.completed : 0));
    return <section class="card"><div class="card-head"><span class="icon-tile" aria-hidden="true">{'▦'}</span><h2>Activity year</h2></div>
      <p class="muted">365 days ending {days[days.length - 1].date}. Select a day for counts.</p>
      <div class="scroll"><div class="heatmap" role="group" aria-label="Activity by day, Sunday to Saturday">
        {cells.map(day => day ? <div class={`cell level-${day.done + day.completed === 0 ? 0 : Math.ceil((day.done + day.completed) / maximum * 4)}`}
          tabindex={0} role="img" aria-label={description(day)} title={description(day)}
          onMouseEnter={() => { this.active = day; }} onFocus={() => { this.active = day; }}
          onClick={() => { this.active = day; }} /> : <span aria-hidden="true" />)}
      </div></div>
      <div class="legend" aria-label="Five activity levels"><span>Less</span>{[0, 1, 2, 3, 4].map(level =>
        <span class={`cell level-${level}`} aria-hidden="true" />)}<span>More</span></div>
      <div class="tooltip" role="status">{this.active ? description(this.active) : 'Focus or hover over a day to see counts.'}</div>
    </section>;
  }
}
