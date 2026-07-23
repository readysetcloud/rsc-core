/*
 * Framework-agnostic sparkline core. The React <TrendSparkline> and the
 * vanilla renderSparkline() both draw from this geometry so every surface
 * renders the identical trend line.
 */

export const SPARKLINE_VIEWBOX_WIDTH = 100;
export const SPARKLINE_VIEWBOX_HEIGHT = 28;

export interface SparklinePoint {
  x: number;
  y: number;
}

export interface SparklineGeometry {
  /** Polyline points attribute for the trend line. */
  line: string;
  /** Path data for the soft area fill under the line. */
  area: string;
  /** The final (most recent) point, emphasized as a dot. */
  last: SparklinePoint;
}

/**
 * Maps a metric history (oldest first) onto the 100x28 sparkline viewBox.
 * Returns null when there are fewer than two points — nothing to draw.
 */
export function sparklineGeometry(values: number[]): SparklineGeometry | null {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const top = 3;
  const bottom = 25;

  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * SPARKLINE_VIEWBOX_WIDTH;
    const y = range === 0 ? (top + bottom) / 2 : bottom - ((value - min) / range) * (bottom - top);
    return { x, y };
  });

  const line = points.map(p => `${p.x},${p.y}`).join(' ');
  const area = `M0,${SPARKLINE_VIEWBOX_HEIGHT} L${points.map(p => `${p.x},${p.y}`).join(' L')} L${SPARKLINE_VIEWBOX_WIDTH},${SPARKLINE_VIEWBOX_HEIGHT} Z`;
  const last = points[points.length - 1]!;

  return { line, area, last };
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Vanilla renderer for script-tag consumers: fills `el` with the sparkline
 * markup (same classes and drawing as the React component). Clears the
 * element when there are fewer than two values.
 */
export function renderSparkline(el: HTMLElement, values: number[]): void {
  const geometry = sparklineGeometry(values);
  el.textContent = '';

  if (!geometry) return;

  el.classList.add('sparkline');
  el.setAttribute('aria-hidden', 'true');

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${SPARKLINE_VIEWBOX_WIDTH} ${SPARKLINE_VIEWBOX_HEIGHT}`);
  svg.setAttribute('preserveAspectRatio', 'none');

  const area = document.createElementNS(SVG_NS, 'path');
  area.setAttribute('d', geometry.area);
  area.setAttribute('fill', 'currentColor');
  area.setAttribute('opacity', '0.12');

  const line = document.createElementNS(SVG_NS, 'polyline');
  line.setAttribute('points', geometry.line);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', 'currentColor');
  line.setAttribute('stroke-width', '1.5');
  line.setAttribute('stroke-linejoin', 'round');
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('vector-effect', 'non-scaling-stroke');

  svg.append(area, line);

  const dot = document.createElement('span');
  dot.className = 'sparkline-dot';
  dot.style.left = `${geometry.last.x}%`;
  dot.style.top = `${(geometry.last.y / SPARKLINE_VIEWBOX_HEIGHT) * 100}%`;

  el.append(svg, dot);
}
