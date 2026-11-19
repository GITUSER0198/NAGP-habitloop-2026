import { Component, Element, h, Prop } from '@stencil/core';
import { chartPoints, ChartPoint, JsonArray } from '../../utils/data';
import { Details } from '../../utils/ui';

@Component({ tag: 'hl-chart', styleUrl: '../../styles/component.css', shadow: true })
export class HlChart {
  @Element() host!: HTMLElement;
  @Prop() type: 'trend' | 'bar' = 'trend';
  @Prop() data: JsonArray<ChartPoint | number> = [];

  render() {
    const points = chartPoints(this.data);
    if (!points.length) return <section class="card"><h2>Activity chart</h2><p class="empty" role="status">No chart data</p></section>;
    const max = points.reduce((maximum, point) => Math.max(maximum, point.value), 1);
    const x = (i: number): number => points.length === 1 ? 320 : 40 + i * 560 / (points.length - 1);
    const y = (value: number): number => 200 - value / max * 170;
    const width = 560 / points.length;
    return <section class="card"><h2>{this.type === 'bar' ? 'Activity totals' : 'Activity trend'}</h2>
      <svg class="chart" viewBox="0 0 640 245" role="img" aria-label={`${this.type} chart with ${points.length} values`}>
        <title>Activity {this.type}</title>
        <line class="axis" x1="40" y1="200" x2="610" y2="200" />
        <text x="8" y="30">{max}</text><text x="16" y="205">0</text>
        {this.type === 'bar' ? points.map((point, i) => <rect class="bar"
          x={40 + i * width + width * 0.1} y={y(point.value)} width={width * 0.8} height={200 - y(point.value)}>
          <title>{point.label}: {point.value}</title></rect>) : [
          <polyline class="plot" points={points.map((point, i) => `${x(i)},${y(point.value)}`).join(' ')} />,
          ...points.map((point, i) => <circle class="point" cx={x(i)} cy={y(point.value)} r="4"><title>{point.label}: {point.value}</title></circle>),
        ]}
        <text x="40" y="230">{points[0].label}</text>
        {points.length > 1 && <text x="600" y="230" text-anchor="end">{points[points.length - 1].label}</text>}
      </svg>
      <Details host={this.host} summary={`Data table (${points.length} values)`}>
        <div class="scroll"><table><thead><tr><th scope="col">Label</th><th scope="col">Value</th></tr></thead>
          <tbody>{points.map(point => <tr><td>{point.label}</td><td>{point.value}</td></tr>)}</tbody></table></div>
      </Details>
    </section>;
  }
}
