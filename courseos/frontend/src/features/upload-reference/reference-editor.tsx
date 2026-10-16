import { useRef, useState } from 'react';
import { FileText, Link2, Upload } from 'lucide-react';
import type { Requirements } from '../../entities/course/model/schema';
import { useApi } from '../../entities/course/api/provider';
import { referenceUrlError, userReference } from '../../entities/course/model/user-reference';
import { contentHash } from '../../shared/lib/decimal';
import { Badge, ErrorMessage, Field, statuses } from '../../shared/ui/ui';
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
  const urlError = referenceUrlError(url);
  const textError =
    attempted && !text.trim() && !url.trim() ? 'Вставьте текст или ссылку.' : undefined;
  const [pending, setPending] = useState(false);
  const [textVerified, setTextVerified] = useState(false);
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
    const source = userReference({
      name: name || (url ? 'Ссылка методиста' : 'Текст методиста'),
      text,
      url: url.trim(),
    });
    source.checked_at = textVerified && text.trim() ? new Date().toISOString() : '';
    source.hash = await contentHash({ text, url: source.url });
    if (source.provenance && text.trim() && textVerified) {
      source.provenance.access = 'read';
      source.provenance.content = 'confirmed';
    }
    onChange([...references, source]);
    setAttempted(false);
    setText('');
    setUrl('');
    setName('');
    setTextVerified(false);
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
          onChange={(e) => {
            setText(e.target.value);
            setTextVerified(false);
          }}
          rows={3}
          placeholder="Вставьте фрагмент, на который должна опираться программа"
        />
      </Field>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={textVerified}
          disabled={!text.trim()}
          onChange={(e) => setTextVerified(e.target.checked)}
        />
        Текст сверен с оригиналом
      </label>
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
            {!source.text.trim()
              ? 'Текст источника не получен.'
              : source.provenance?.access === 'read' && source.provenance.content === 'confirmed'
                ? 'Текст сверен с оригиналом.'
                : 'Текст ещё не сверен с оригиналом.'}
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
    </div>
  );
}
