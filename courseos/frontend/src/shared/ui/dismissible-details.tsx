import { useEffect, useRef, type ComponentProps } from 'react';

/** A transient menu built on native details/summary keyboard behavior. */
export function DismissibleDetails({
  dismissKey,
  ...props
}: ComponentProps<'details'> & { dismissKey: string }) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [dismissKey]);

  useEffect(() => {
    const dismissOutside = (event: Event) => {
      const panel = ref.current;
      if (panel?.open && event.target instanceof Node && !panel.contains(event.target)) {
        panel.open = false;
      }
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      const panel = ref.current;
      if (event.key === 'Escape' && panel?.open) {
        event.preventDefault();
        event.stopPropagation();
        panel.open = false;
        panel.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', dismissOutside, true);
    document.addEventListener('focusin', dismissOutside);
    document.addEventListener('keydown', dismissOnEscape, true);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true);
      document.removeEventListener('focusin', dismissOutside);
      document.removeEventListener('keydown', dismissOnEscape, true);
    };
  }, []);

  return <details {...props} ref={ref} />;
}
