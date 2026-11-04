import type { CanvasNode } from '../types/consultation';

export interface CanvasCursor { id: string; pos: number }

// Insert below the selected line; a structured section must never split a word.
export function insertCanvasBlock(nodes: CanvasNode[], cursor: CanvasCursor | null, block: CanvasNode, textId: string): CanvasNode[] {
  const index = cursor ? nodes.findIndex(node => node.id === cursor.id) : -1;
  if (index < 0) return [...nodes, block, { type: 'text', id: textId, content: '' }];
  const selected = nodes[index];
  if (selected.type !== 'text') {
    const following = nodes.slice(index + 1);
    return [...nodes.slice(0, index + 1), block,
      ...(following[0]?.type === 'text' ? [] : [{ type: 'text' as const, id: textId, content: '' }]), ...following];
  }
  const position = Math.max(0, Math.min(cursor!.pos, selected.content.length));
  const newline = selected.content.indexOf('\n', position);
  const lineEnd = newline < 0 ? selected.content.length : newline;
  const before = selected.content.slice(0, lineEnd);
  const rest = newline < 0 ? '' : selected.content.slice(lineEnd + 1);
  return [...nodes.slice(0, index), { ...selected, content: before }, block,
    { type: 'text', id: textId, content: rest }, ...nodes.slice(index + 1)];
}
