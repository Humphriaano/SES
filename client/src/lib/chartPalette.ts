// Shared ordered chart-series palette for the Reports/BI dashboard — defined
// once so a palette change is a one-file edit, per the brand retheme brief.
// Starts from the system accent blue (it lightens itself in dark mode) and
// uses neutrals before any other hue, so charts read as part of the app.
export const CHART_PALETTE = [
  'var(--selection-accent)',
  'var(--text-muted)',
  'var(--ses-blue-deep)',
  '#7FB4DC',
  '#8b5cf6',
  '#94a3b8',
];
