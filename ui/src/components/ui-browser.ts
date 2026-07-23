/*
 * Framework-agnostic UI helpers for plain <script> consumers (window.rscUi).
 * Everything CSS-only (stat tiles, trend pills, segmented controls, page
 * heroes, status badges) needs no JS — just the shipped classes. This bundle
 * carries the pieces that require drawing.
 */

export {
  renderSparkline,
  sparklineGeometry,
  SPARKLINE_VIEWBOX_HEIGHT,
  SPARKLINE_VIEWBOX_WIDTH,
  type SparklineGeometry,
  type SparklinePoint
} from './sparkline';
