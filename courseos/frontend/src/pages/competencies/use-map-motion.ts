import { useLayoutEffect, useRef, type RefObject } from 'react';

type CardState = {
  element: HTMLElement;
  clone: HTMLElement;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
};
const easing = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

/** Animate only cards and connections; stable controls never participate in FLIP. */
export function useMapMotion(root: RefObject<HTMLDivElement | null>, signature: string) {
  const previous = useRef(new Map<string, CardState>());
  const lastSignature = useRef(signature);
  const animations = useRef<Animation[]>([]);
  const ghosts = useRef<HTMLElement[]>([]);
  useLayoutEffect(() => {
    const host = root.current;
    if (!host) return;
    const changed = lastSignature.current !== signature;
    lastSignature.current = signature;
    if (!changed && previous.current.size) return;
    // Sample interrupted transforms before cancelling, so the next transition starts
    // at the currently displayed position rather than the previous destination.
    const offsets = new Map<string, { x: number; y: number; opacity: string }>();
    for (const [id, state] of previous.current) {
      const style = getComputedStyle(state.element);
      const matrix = new DOMMatrixReadOnly(
        style.transform === 'none' ? undefined : style.transform,
      );
      offsets.set(id, { x: matrix.m41, y: matrix.m42, opacity: style.opacity });
    }
    if (changed) {
      animations.current.forEach((a) => a.cancel());
      animations.current = [];
      ghosts.current.forEach((g) => g.remove());
      ghosts.current = [];
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const next = new Map<string, CardState>();
    const origin = host.getBoundingClientRect();
    const ranks = [0, 0, 0, 0];
    host.querySelectorAll<HTMLElement>('[data-motion-card]').forEach((element) => {
      if (!element.getClientRects().length) return;
      const id = `${element.closest('[data-chain-id]')?.getAttribute('data-chain-id') || 'map'}:${element.dataset.motionCard}`;
      const column = Number(element.dataset.motionColumn);
      const delay = column * 32 + Math.min(ranks[column]++, 4) * 12;
      const rect = element.getBoundingClientRect();
      const old = previous.current.get(id);
      const offset = offsets.get(id);
      // Coordinates are measured in screen pixels and converted to canvas units.
      const scale = element.closest('.map-canvas')
        ? Number(
            new DOMMatrixReadOnly(getComputedStyle(element.closest('.map-canvas')!).transform).a,
          )
        : 1;
      if (changed && !reduced) {
        const opacity = getComputedStyle(element).opacity;
        const frames = old
          ? [
              {
                transform: `translate(${(old.x - (rect.left - origin.left)) / scale + (offset?.x || 0)}px, ${(old.y - (rect.top - origin.top)) / scale + (offset?.y || 0)}px)`,
                opacity: offset?.opacity || opacity,
              },
              { transform: 'translate(0, 0)', opacity },
            ]
          : [
              { transform: 'translateY(12px) scale(0.97)', opacity: 0 },
              { transform: 'translateY(0) scale(1)', opacity },
            ];
        animations.current.push(
          element.animate(frames, {
            duration: 280,
            delay: old ? 0 : delay,
            easing,
            fill: 'backwards',
          }),
        );
      }
      next.set(id, {
        element,
        clone: element.cloneNode(true) as HTMLElement,
        x: rect.left - origin.left,
        y: rect.top - origin.top,
        width: rect.width,
        height: rect.height,
        scale,
      });
    });
    if (changed && !reduced) {
      for (const [id, old] of previous.current) {
        if (next.has(id)) continue;
        const ghost = old.clone;
        ghost.removeAttribute('data-motion-card');
        ghost.setAttribute('aria-hidden', 'true');
        ghost.inert = true;
        const offset = offsets.get(id);
        Object.assign(ghost.style, {
          position: 'absolute',
          left: `${old.x + (offset?.x || 0) * old.scale}px`,
          top: `${old.y + (offset?.y || 0) * old.scale}px`,
          width: `${old.width / old.scale}px`,
          height: `${old.height / old.scale}px`,
          transform: `scale(${old.scale})`,
          transformOrigin: 'top left',
          margin: '0',
          pointerEvents: 'none',
          zIndex: '2',
        });
        host.append(ghost);
        ghosts.current.push(ghost);
        const animation = ghost.animate([{ opacity: offset?.opacity || 1 }, { opacity: 0 }], {
          duration: 160,
          easing,
        });
        animation.onfinish = () => {
          ghost.remove();
          animation.cancel();
        };
        animations.current.push(animation);
      }
      host.querySelectorAll('.map-lines path').forEach((line) => {
        animations.current.push(
          line.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: 70,
            delay: 375,
            easing,
            fill: 'backwards',
          }),
        );
      });
    }
    animations.current.forEach((animation) => {
      if (!animation.onfinish) animation.onfinish = () => animation.cancel();
    });
    previous.current = next;
  });
  useLayoutEffect(() => {
    const refresh = () => {
      const host = root.current;
      if (!host) return;
      const origin = host.getBoundingClientRect();
      for (const state of previous.current.values()) {
        if (!state.element.isConnected) continue;
        const rect = state.element.getBoundingClientRect();
        const canvas = state.element.closest('.map-canvas');
        state.scale = canvas ? new DOMMatrixReadOnly(getComputedStyle(canvas).transform).a : 1;
        const transform = getComputedStyle(state.element).transform;
        const matrix = new DOMMatrixReadOnly(transform === 'none' ? undefined : transform);
        state.x = rect.left - origin.left - matrix.m41 * state.scale;
        state.y = rect.top - origin.top - matrix.m42 * state.scale;
      }
    };
    window.addEventListener('scroll', refresh, true);
    window.addEventListener('resize', refresh);
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const cancel = () => {
      animations.current.forEach((a) => a.cancel());
      ghosts.current.forEach((g) => g.remove());
    };
    media.addEventListener('change', cancel);
    return () => {
      cancel();
      media.removeEventListener('change', cancel);
      window.removeEventListener('scroll', refresh, true);
      window.removeEventListener('resize', refresh);
    };
  }, []);
}
