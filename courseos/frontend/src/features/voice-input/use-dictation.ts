import { useCallback, useEffect, useRef, useState } from 'react';

// В стандартных типах DOM нет конструктора SpeechRecognition: описываем только то, что используем.
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: SpeechRecognitionResultList }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionConstructor = new () => Recognition;

function recognitionConstructor() {
  const speechWindow = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}

const errorMessages: Record<string, string> = {
  'not-allowed':
    'Доступ к микрофону запрещён. Разрешите его через значок замка в адресной строке и попробуйте снова.',
  'audio-capture': 'Микрофон не найден. Проверьте, что он подключён.',
  network: 'Распознавание речи недоступно: нет связи с сервисом браузера.',
  'language-not-supported': 'Браузер не распознаёт русскую речь.',
};
errorMessages['service-not-allowed'] = errorMessages['not-allowed'];

/** Дописывает надиктованное к тексту, который был в поле на момент начала записи. */
export function useDictation({
  getText,
  setText,
}: {
  getText: () => string;
  setText: (text: string) => void;
}) {
  const [isSupported] = useState(() => !!recognitionConstructor());
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState('');
  const recognitionRef = useRef<Recognition | null>(null);
  const callbacks = useRef({ getText, setText });
  callbacks.current = { getText, setText };

  const start = useCallback(() => {
    const Recognition = recognitionConstructor();
    if (!Recognition || recognitionRef.current) return;
    const recognition = new Recognition();
    recognition.lang = 'ru-RU';
    recognition.interimResults = true;
    recognition.continuous = true;
    const textBefore = callbacks.current.getText().trimEnd();
    // В непрерывном режиме results содержит всю сессию: промежуточные фразы
    // каждый раз пересобираются и заменяются окончательными, а не копятся.
    recognition.onresult = ({ results }) => {
      const spoken = Array.from(results, (result) => result[0].transcript)
        .join('')
        .trim();
      callbacks.current.setText([textBefore, spoken].filter(Boolean).join(' '));
    };
    recognition.onerror = (event) => {
      // no-speech — пользователь промолчал, aborted — запись остановили мы сами.
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      setError(errorMessages[event.error] ?? `Не удалось распознать речь (${event.error}).`);
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setIsListening(false);
    };
    recognitionRef.current = recognition;
    setError('');
    setIsListening(true);
    recognition.start();
  }, []);

  const stop = useCallback(() => recognitionRef.current?.stop(), []);

  useEffect(
    () => () => {
      const recognition = recognitionRef.current;
      if (!recognition) return;
      recognition.onresult = recognition.onend = recognition.onerror = null;
      recognition.abort();
    },
    [],
  );

  return { isSupported, isListening, start, stop, error };
}
