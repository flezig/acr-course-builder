import { useRef } from 'react';
import { Mic } from 'lucide-react';
import type { useDictation } from './use-dictation';

const hint = 'Нажмите и удерживайте для записи. Короткий клик — начать или остановить диктовку';
const holdThresholdMs = 300;

export function DictationButton({ dictation }: { dictation: ReturnType<typeof useDictation> }) {
  const pressedAt = useRef(0);
  const listeningBeforePress = useRef(false);
  if (!dictation.isSupported) return null;

  // Удержание удобно на компьютере, а держать палец на телефоне неудобно:
  // поэтому короткое нажатие оставляет запись включённой до следующего нажатия.
  return (
    <button
      type="button"
      className="dictation-button"
      aria-label={hint}
      title={hint}
      aria-pressed={dictation.isListening}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        pressedAt.current = Date.now();
        listeningBeforePress.current = dictation.isListening;
        if (!dictation.isListening) dictation.start();
      }}
      onPointerUp={() => {
        const held = Date.now() - pressedAt.current >= holdThresholdMs;
        if (listeningBeforePress.current || held) dictation.stop();
      }}
      onPointerCancel={dictation.stop}
      onContextMenu={(event) => event.preventDefault()}
      onClick={(event) => {
        // detail === 0 — нажатие с клавиатуры, у него нет pointer-событий.
        if (event.detail !== 0) return;
        if (dictation.isListening) dictation.stop();
        else dictation.start();
      }}
    >
      <Mic size={18} />
    </button>
  );
}
