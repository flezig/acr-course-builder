import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FileText, Link2, Paperclip, Plus, X } from 'lucide-react';
import type { Requirements } from '../../entities/course/model/schema';
import { useApi } from '../../entities/course/api/provider';
import { isProfessionalStandardReference } from '../../entities/course/model/professional-standards';
import {
  referenceUrlError,
  userReference,
  type Reference,
} from '../../entities/course/model/user-reference';
import { Field, Notice } from '../../shared/ui/ui';

/** Нижняя часть композера запроса: материалы, кнопка «+» с меню и кнопка отправки справа. */
export function CreateReferences({
  references,
  onChange,
  sendButton,
}: {
  references: Requirements['references'];
  onChange: (references: Requirements['references']) => void;
  sendButton: ReactNode;
}) {
  const { api } = useApi();
  const [menuOpen, setMenuOpen] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [focusLinkId, setFocusLinkId] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const materials = references.filter((reference) => !isProfessionalStandardReference(reference));

  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [menuOpen]);

  const updateUrl = (source: Reference, url: string) =>
    onChange(
      references.map((reference) =>
        reference.id === source.id ? userReference({ ...source, url }) : reference,
      ),
    );
  const remove = (source: Reference) =>
    onChange(references.filter((reference) => reference.id !== source.id));
  const addLink = () => {
    const id = `useful-link-${crypto.randomUUID()}`;
    onChange([...references, userReference({ id, name: '' })]);
    setFocusLinkId(id);
    setMenuOpen(false);
  };
  // У программы ещё нет идентификатора, а загрузка файла на сервер привязана к программе.
  // Поэтому файл здесь не отправляется: методист видит, где его можно приложить.
  const attachFile = (file?: File) => {
    if (!file) return;
    setUploadError(
      api.mode === 'demo'
        ? `«${file.name}»: извлечение PDF/DOCX требует backend. Вставьте текст. Сканы без текста и PPTX не поддерживаются.`
        : `«${file.name}»: файлы прикрепляются после создания программы — в источниках карты результатов. Пока добавьте ссылку на материал.`,
    );
  };

  return (
    <section className="create-references" aria-label="Материалы для программы">
      {!!materials.length && (
        <ul className="attachment-list">
          {materials.map((source) =>
            source.text ? (
              <li className="attachment-chip" key={source.id}>
                <FileText size={16} aria-hidden="true" />
                <span>{source.name} · текст сохранён</span>
                <button
                  type="button"
                  aria-label={`Убрать «${source.name}»`}
                  onClick={() => remove(source)}
                >
                  <X size={14} />
                </button>
              </li>
            ) : (
              <li className="attachment-link" key={source.id}>
                <Link2 size={16} aria-hidden="true" />
                <Field
                  label="Ссылка на материал"
                  className="attachment-link-field"
                  error={referenceUrlError(source.url)}
                >
                  <input
                    type="url"
                    required
                    value={source.url}
                    placeholder="Вставьте ссылку на прошлую программу или материал"
                    ref={(input) => {
                      if (input && focusLinkId === source.id) {
                        input.focus();
                        setFocusLinkId('');
                      }
                    }}
                    onChange={(event) => updateUrl(source, event.target.value)}
                    // Пустая строка ссылки ничего не добавляет к запросу, поэтому не держим её
                    // с ошибкой «заполните поле», а убираем, как пустое вложение в чате.
                    onBlur={(event) => {
                      if (!event.target.value.trim()) remove(source);
                    }}
                  />
                </Field>
                <button type="button" aria-label="Убрать ссылку" onClick={() => remove(source)}>
                  <X size={14} />
                </button>
              </li>
            ),
          )}
        </ul>
      )}
      <div
        className="attachment-menu"
        ref={menuRef}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && menuOpen) {
            event.preventDefault();
            setMenuOpen(false);
            menuRef.current?.querySelector<HTMLElement>('.attachment-trigger')?.focus();
          }
          if (menuOpen && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault();
            const items = [...menuRef.current!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
            const step = event.key === 'ArrowDown' ? 1 : -1;
            const current = items.indexOf(document.activeElement as HTMLElement);
            items[(current + step + items.length) % items.length].focus();
          }
        }}
      >
        <button
          type="button"
          className="attachment-trigger"
          aria-label="Добавить материалы"
          title="Добавить файл или ссылку"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Plus size={18} />
        </button>
        {!materials.length && (
          <small className="attachment-hint">Прошлая программа, PDF, DOCX или ссылка</small>
        )}
        {menuOpen && (
          <div className="attachment-popover" role="menu" aria-label="Добавить материалы">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                fileRef.current?.click();
              }}
            >
              <Paperclip size={16} aria-hidden="true" />
              <span>
                Прикрепить файл
                <small>PDF или DOCX</small>
              </span>
            </button>
            <button type="button" role="menuitem" onClick={addLink}>
              <Link2 size={16} aria-hidden="true" />
              <span>
                Добавить ссылку
                <small>Содержимое ссылки не загружается</small>
              </span>
            </button>
          </div>
        )}
        <input
          ref={fileRef}
          className="sr-only"
          tabIndex={-1}
          aria-label="Загрузить PDF или DOCX"
          type="file"
          accept=".pdf,.docx"
          onChange={(event) => {
            attachFile(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        {sendButton}
      </div>
      {uploadError && <Notice tone="error">{uploadError}</Notice>}
    </section>
  );
}
