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
}: {
  references: Requirements['references'];
  onChange: (references: Requirements['references']) => void;
  courseId: string;
}) {
  const { api } = useApi();
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [claim, setClaim] = useState('');
  const [excerpt, setExcerpt] = useState('');
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
    if (!url) return;
    if (urlError) {
      urlRef.current?.focus();
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/sources/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, claim, excerpt }),
      });
      const source = await response.json();
      if (!response.ok) throw new Error(source.detail || 'Проверка ссылки не выполнена.');
      source.name = name || source.name;
      source.claim = claim;
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
      const source = await api.uploadReference(courseId, file);
      onChange([...references, source]);
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };
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
      <Field label="Проверяемое утверждение">
        <input value={claim} onChange={(e) => setClaim(e.target.value)} />
      </Field>
      <Field label="Подтверждающий фрагмент страницы (от 30 символов)">
        <textarea value={excerpt} onChange={(e) => setExcerpt(e.target.value)} rows={2} />
      </Field>
      <p>
        Наличие фрагмента на странице не подтверждает истинность утверждения. Применимость проверяет
        методист.
      </p>
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
        <button type="button" disabled={pending || !url} onClick={() => void retrieve()}>
          Получить текст по ссылке
        </button>
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
            {source.text.length > 12000 &&
              ` В генерацию передаются первые 12 000 из ${source.text.length} символов.`}
          </p>
          <p>
            {!source.text.trim()
              ? 'Текст источника не получен.'
              : source.provenance?.access === 'read' && source.provenance.content === 'confirmed'
                ? 'Текст сверен с оригиналом.'
                : 'Текст ещё не сверен с оригиналом.'}
          </p>
          {source.extraction && (
            <p>
              Извлечение: {source.extraction.status === 'failed' ? 'не выполнено' : 'выполнено'}.
              Передано {source.extraction.transmitted_chars} из {source.extraction.original_chars}{' '}
              символов{source.extraction.truncated ? ' — текст обрезан' : ''}.
            </p>
          )}
          {source.verification && (
            <div>
              <p>
                Доступность:{' '}
                {source.verification.availability === 'available' ? 'доступна' : 'недоступна'}; HTTP{' '}
                {source.verification.http_status ?? 'нет ответа'}; {source.verification.checked_at}
              </p>
              <p>Конечный URL: {source.verification.final_url}</p>
              <p>Утверждение: {source.verification.claim}</p>
              <p>{source.verification.reason}</p>
              {source.verification.excerpt && (
                <blockquote>{source.verification.excerpt}</blockquote>
              )}
            </div>
          )}
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
