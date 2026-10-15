import { useRef, useState } from 'react';
import { FileText, Link2, Upload } from 'lucide-react';
import type { Requirements } from '../../entities/course/model/schema';
import { useApi } from '../../entities/course/api/provider';
import { contentHash } from '../../shared/lib/decimal';
import { Badge, ErrorMessage, Field, Notice, statuses } from '../../shared/ui/ui';
export function ReferenceEditor({
  references,
  onChange,
  courseId,
  uploadOnly = false,
}: {
  references: Requirements['references'];
  onChange: (references: Requirements['references']) => void;
  courseId?: string;
  uploadOnly?: boolean;
}) {
  const { api } = useApi();
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [attempted, setAttempted] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const urlError = (() => {
    if (!url.trim()) return undefined;
    try {
      const parsed = new URL(url.trim());
      if (['https:', 'http:'].includes(parsed.protocol)) return undefined;
    } catch {
      /* Show the same guidance for an incomplete URL. */
    }
    return 'Введите полную ссылку, например https://example.com.';
  })();
  const textError =
    attempted && !text.trim() && !url.trim() ? 'Вставьте текст или ссылку.' : undefined;
  const [pending, setPending] = useState(false);
  const [coordinate, setCoordinate] = useState('');
  const [claim, setClaim] = useState('');
  const [read, setRead] = useState(false);
  const [contentConfirmed, setContentConfirmed] = useState(false);
  const add = async () => {
    setError(null);
    setAttempted(true);
    if (!text.trim() && !url.trim()) {
      textRef.current?.focus();
      return;
    }
    if (urlError) {
      urlRef.current?.focus();
      return;
    }
    const source = {
      id: crypto.randomUUID(),
      name: name || (url ? 'Ссылка методиста' : 'Текст методиста'),
      text,
      url: url.trim(),
      status: text ? ('provided' as const) : ('unconfirmed' as const),
      coordinate:
        coordinate || (text ? 'Вставленный фрагмент; координаты в оригинале не указаны' : ''),
      claim: claim || 'Ввод пользователя; применимость к результатам требует проверки',
      checked_at: read && text ? new Date().toISOString() : '',
      scope: url
        ? 'Содержимое URL не загружено; выполнена только регистрация ссылки'
        : 'Сохранён фактический текст без подтверждения достоверности',
      hash: await contentHash({ text, url }),
      provenance: {
        origin: text ? ('user_text' as const) : ('url' as const),
        access:
          text && read
            ? ('read' as const)
            : text
              ? ('available' as const)
              : ('registered' as const),
        content:
          text && read && contentConfirmed ? ('confirmed' as const) : ('unverified' as const),
        extent: text ? ('excerpt' as const) : ('none' as const),
        authors: '',
        year: '',
        title: name,
        doi: '',
        study_type: '',
        population: '',
        result: '',
      },
    };
    onChange([...references, source]);
    setAttempted(false);
    setText('');
    setUrl('');
    setName('');
    setCoordinate('');
    setClaim('');
    setRead(false);
    setContentConfirmed(false);
  };
  const retrieve = async () => {
    if (!courseId || !url) return;
    if (urlError) {
      urlRef.current?.focus();
      return;
    }
    setPending(true);
    setError(null);
    try {
      const source = await api.retrieveReference(courseId, url);
      onChange([...references, source]);
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };
  const upload = async (file?: File) => {
    if (!file) return;
    setPending(true);
    try {
      if (!courseId)
        throw new Error(
          api.mode === 'demo'
            ? `«${file.name}»: извлечение PDF/DOCX требует backend. Вставьте текст. Сканы без текста и PPTX не поддерживаются.`
            : 'Для загрузки сначала создайте курс, затем откройте источники в карте результатов.',
        );
      const source = await api.uploadReference(courseId, file);
      onChange([...references, source]);
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };
  const uploadButton = (
    <label className="button secondary upload">
      <Upload size={16} /> PDF или DOCX
      <input
        aria-label="Загрузить PDF или DOCX"
        type="file"
        accept=".pdf,.docx"
        onChange={(e) => void upload(e.target.files?.[0])}
        disabled={pending}
      />
    </label>
  );
  if (uploadOnly)
    return (
      <div className="create-upload">
        {uploadButton}
        <ErrorMessage error={error} />
      </div>
    );
  return (
    <div>
      <div className="reference-fields">
        <Field label="Название источника">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Например, требования заказчика"
          />
        </Field>
        <Field label="Ссылка" error={urlError}>
          <input
            ref={urlRef}
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
          />
        </Field>
      </div>
      <Field label="Текст референса" error={textError}>
        <textarea
          ref={textRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="Вставьте фрагмент, на который должен опираться каркас"
        />
      </Field>
      <details>
        <summary>Происхождение и проверка фрагмента</summary>
        <Field label="Координаты в оригинале">
          <input
            value={coordinate}
            onChange={(e) => setCoordinate(e.target.value)}
            placeholder="Страница, раздел, абзац"
          />
        </Field>
        <Field label="Какое утверждение поддерживает фрагмент">
          <textarea value={claim} onChange={(e) => setClaim(e.target.value)} />
        </Field>
        <label>
          <input
            type="checkbox"
            checked={read}
            disabled={!text.trim()}
            onChange={(e) => setRead(e.target.checked)}
          />
          Я прочитал сохранённый фрагмент
        </label>
        <label>
          <input
            type="checkbox"
            checked={contentConfirmed}
            disabled={!text.trim() || !read}
            onChange={(e) => setContentConfirmed(e.target.checked)}
          />
          Содержание фрагмента подтверждено мной
        </label>
        <p>
          Эти отметки не подтверждают применимость к конкретному решению. Она сохраняется отдельно в
          основаниях каркаса.
        </p>
      </details>
      <div className="actions">
        <button type="button" onClick={() => void add()}>
          <FileText size={16} /> Добавить источник
        </button>
        {uploadButton}
        {courseId && (
          <button type="button" disabled={pending || !url} onClick={() => void retrieve()}>
            Получить текст по ссылке
          </button>
        )}
      </div>
      <ErrorMessage error={error} />
      {references.map((source) => (
        <details className="source" key={source.id}>
          <summary>
            {source.url ? <Link2 size={16} /> : <FileText size={16} />}
            {source.name}
            <Badge>{statuses[source.status]}</Badge>
          </summary>
          <p>
            {source.coordinate} · {source.scope}
          </p>
          <p>
            Происхождение: {source.provenance?.origin || 'не установлено (старая запись)'}. Доступ:{' '}
            {source.provenance?.access || 'не установлен'}. Содержание:{' '}
            {source.provenance?.content || 'не проверено'}. Объём:{' '}
            {source.provenance?.extent || 'не установлен'}.
          </p>
          <pre>
            {source.text || 'Текст не получен. Регистрация ссылки не подтверждает её содержание.'}
          </pre>
          {source.url && (
            <a href={source.url} target="_blank" rel="noreferrer">
              Открыть исходный URL ↗
            </a>
          )}
          <button
            type="button"
            className="link-button"
            onClick={() => onChange(references.filter((s) => s.id !== source.id))}
          >
            Удалить из черновика
          </button>
        </details>
      ))}
      <Notice>
        Текст референса используется как данные. Он не может утвердить каркас или разрешить вызов
        внешнего сервиса.
      </Notice>
    </div>
  );
}
