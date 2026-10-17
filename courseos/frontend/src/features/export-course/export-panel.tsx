import { useState } from 'react';
import { Download } from 'lucide-react';
import type { Snapshot } from '../../entities/course/model/schema';
import { useApi } from '../../entities/course/api/provider';
import { exportFileName } from '../../entities/course/export/file-names';
import { Badge, ErrorMessage, Panel } from '../../shared/ui/ui';
import { saveFile } from '../../shared/lib/use-unsaved';
import './export-panel.css';

const exportFormats = {
  md: {
    title: 'Программа и пояснения',
    description:
      'Весь комплект одним читаемым файлом: что проверить перед утверждением, учебный план, материалы по темам и почему план устроен так.',
    label: 'MD',
  },
  json: {
    title: 'Данные курса',
    description:
      'Сводка программы и полная версия курса с материалами и результатами проверок — для загрузки в другие системы.',
    label: 'JSON',
  },
  docx: {
    title: 'Программа по шаблону АЦР',
    description:
      'Документ Word для согласования: учебный план, рабочие программы, оценочные материалы и лист проверки методистом.',
    label: 'DOCX',
  },
  pptx: {
    title: 'Слайды лекций',
    description: 'Презентация по темам курса с заметками для преподавателя.',
    label: 'PPTX',
  },
  lms: {
    title: 'Тесты для LMS',
    description: 'Вопросы с ключами в формате Moodle XML для импорта в банк вопросов.',
    label: 'LMS',
  },
};

const exportStatuses = {
  ready: { label: 'Готов к скачиванию', tone: 'green' },
  unavailable: { label: 'Пока недоступен', tone: 'neutral' },
  creating: { label: 'Создаётся', tone: 'amber' },
  failed: { label: 'Ошибка создания', tone: 'red' },
};
export function ExportPanel({ snapshot }: { snapshot: Snapshot }) {
  const { api } = useApi();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const [success, setSuccess] = useState('');
  const download = async (format: string, fileId: string | null, name: string) => {
    setPending(true);
    setError(null);
    try {
      const blob =
        format === 'md'
          ? await api.exportMarkdown(snapshot.course_id, snapshot.course_version)
          : format === 'json'
            ? await api.exportJson(snapshot.course_id, snapshot.course_version)
            : await api.downloadFile(fileId!);
      saveFile(blob, name);
      setSuccess(`Скачан ${format.toUpperCase()} версии ${snapshot.course_version}`);
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };
  const files = [
    {
      format: 'md' as const,
      status: 'ready' as const,
      course_version: snapshot.course_version,
      file_id: null,
      filename: exportFileName(snapshot, 'md'),
      reason: '',
    },
    ...snapshot.export_manifest,
  ];
  return (
    <Panel
      className="export-panel"
      title="Выгрузки комплекта"
      subtitle={`Версия ${snapshot.course_version} · Черновик — требует проверки методистом`}
    >
      <ul className="export-list" aria-label="Файлы курса">
        {files.map((file) => {
          const { title, description, label } = exportFormats[file.format];
          const status = exportStatuses[file.status];
          return (
            <li className="export-file" key={file.format}>
              <span className="export-file-format">{label}</span>
              <div className="export-file-content">
                <h3>{title}</h3>
                <p>{description}</p>
                {file.course_version !== snapshot.course_version && (
                  <small>Версия файла {file.course_version}</small>
                )}
                {file.reason && (
                  <details className="export-file-details">
                    <summary>
                      {file.status === 'unavailable' ? 'Почему недоступен' : 'Подробнее'}
                    </summary>
                    <p>{file.reason}</p>
                  </details>
                )}
              </div>
              <div className="export-file-actions">
                <Badge tone={status.tone}>{status.label}</Badge>
                <button
                  disabled={file.status !== 'ready' || pending}
                  onClick={() => void download(file.format, file.file_id, file.filename)}
                >
                  <Download size={16} aria-hidden="true" />
                  Скачать {label}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <ErrorMessage error={error} />
      {success && <p role="status">{success}</p>}
    </Panel>
  );
}
