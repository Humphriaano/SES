import type { MetricTag } from '../types';

const LABELS: Record<MetricTag, string> = {
  improving: 'Improving',
  stable: 'Stable',
  'needs-attention': 'Needs attention',
};

export default function StatusTag({ tag }: { tag: MetricTag }) {
  return <span className={`tag tag-${tag}`}>{LABELS[tag]}</span>;
}
