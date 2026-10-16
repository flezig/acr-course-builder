import { useState } from 'react';
import { Download } from 'lucide-react';
import type { Snapshot } from '../../entities/course/model/schema';
import { useApi } from '../../entities/course/api/provider';
import { Badge, ErrorMessage, Panel } from '../../shared/ui/ui';
import { saveFile } from '../../shared/lib/use-unsaved';
import './export-panel.css';

const exportFormats = {
  md: {
    title: 'Программа и обоснования',
    description: 'Аудитория, результаты, темы и часы, задания, оценивание и обоснования решений.',
    label: 'MD',
  },
  json: {
    title: 'Полные данные курса',
    description: 'Структура курса, материалы и результаты проверки в машиночитаемом формате.',
    label: 'JSON',
  },
  docx: {
    title: 'Программа по шаблону АЦР',
    description: 'Документ Word: учебный план, рабочие программы и обязательные разделы.',
    label: 'DOCX',
  },
  pptx: {
    title: 'Планы лекций и слайды',
    description: 'Презентации по модулям с пояснениями для преподавателя.',
    label: 'PPTX',
  },
  lms: {
    title: 'Курс для учебной платформы',
    description: 'Комплект для импорта в систему управления обучением.',
    label: 'LMS',
  },
};

const exportStatuses = {
  ready: { label: 'Готов к скачиванию', tone: 'green' },
  unavailable: { label: 'Недоступен', tone: 'neutral' },
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
      filename: `${snapshot.course_id}-v${snapshot.course_version}-rationale.md`,
      reason: '',
    },
    ...snapshot.export_manifest,
  ];
  return (
    <Panel
      className="export-panel"
      title="Выгрузки комплекта"
      subtitle={`Версия ${snapshot.course_version} · ${api.mode} · Черновик — требует проверки методистом`}
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
                  className={file.format === 'md' ? 'primary' : undefined}
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
