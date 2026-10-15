import { useState } from 'react';
import { Download, FileJson, FileText } from 'lucide-react';
import type { Snapshot } from '../../entities/course/model/schema';
import { useApi } from '../../entities/course/api/provider';
import { Badge, ErrorMessage, Panel } from '../../shared/ui/ui';
import { saveFile } from '../../shared/lib/use-unsaved';
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
  return (
    <Panel
      title="Выгрузки комплекта"
      subtitle={`Версия ${snapshot.course_version} · ${api.mode} · Черновик — требует проверки методистом`}
    >
      <div className="export-grid">
        <div className="export-card">
          <FileText size={25} />
          <strong>Описание курса · Markdown</strong>
          <p>
            Цель, учебный план, задания и пояснения к решениям. В конце — что ещё нужно проверить.
            Версия {snapshot.course_version}.
          </p>
          <button
            disabled={pending}
            onClick={() =>
              void download(
                'md',
                null,
                `${snapshot.course_id}-v${snapshot.course_version}-rationale.md`,
              )
            }
          >
            <Download size={15} />
            Скачать MD
          </button>
        </div>
        {snapshot.export_manifest.map((file) => (
          <div className="export-card" key={file.format}>
            {file.format === 'json' ? <FileJson size={25} /> : <FileText size={25} />}
            <strong>{file.format.toUpperCase()}</strong>
            <Badge tone={file.status === 'ready' ? 'green' : 'neutral'}>
              {file.status === 'ready' ? 'Файл доступен' : 'Не создан'}
            </Badge>
            <p>{file.reason}</p>
            <small>Snapshot v{file.course_version}</small>
            <button
              disabled={file.status !== 'ready' || pending}
              onClick={() => void download(file.format, file.file_id, file.filename)}
            >
              <Download size={15} />
              Скачать {file.format.toUpperCase()}
            </button>
          </div>
        ))}
      </div>
      <ErrorMessage error={error} />
      {success && <p role="status">{success}</p>}
    </Panel>
  );
}
