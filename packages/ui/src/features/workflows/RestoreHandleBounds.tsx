import { useEffect } from 'react';
import { useStoreApi } from '@xyflow/react';

/** Restore port measurements lost when controlled nodes are replaced. */
export function RestoreHandleBounds({ active = true }: { active?: boolean }) {
  const store = useStoreApi();
  useEffect(() => {
    if (!active) return;
    let frame: number | undefined;
    const schedule = () => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        const { domNode, nodeLookup, updateNodeInternals } = store.getState();
        const updates = new Map<
          string,
          { id: string; nodeElement: HTMLDivElement; force: boolean }
        >();
        for (const nodeElement of domNode?.querySelectorAll<HTMLDivElement>(
          'div.react-flow__node[data-id]',
        ) ?? []) {
          const id = nodeElement.dataset.id;
          if (id === undefined) continue;
          const node = nodeLookup.get(id);
          // A kept-mounted tab can be display:none. Measure only after it is
          // visible again, and leave valid measurements and collapsed nodes alone.
          if (
            node &&
            !node.hidden &&
            !node.internals.handleBounds &&
            nodeElement.offsetWidth > 0 &&
            nodeElement.offsetHeight > 0
          )
            updates.set(id, { id, nodeElement, force: true });
        }
        if (updates.size) updateNodeInternals(updates);
      });
    };
    // React Flow keeps the old DOM cards across controlled-node replacements.
    // Their dimensions may not change, so ResizeObserver need not fire again.
    const unsubscribe = store.subscribe((state, previous) => {
      if (state.nodes !== previous.nodes) schedule();
    });
    schedule();
    return () => {
      unsubscribe();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [active, store]);
  return null;
}
