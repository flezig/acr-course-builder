import { useState } from 'react';
import { useApi, useCommand } from '../../entities/course/api/provider';
import type { Snapshot } from '../../entities/course/model/schema';
import { saveFile } from '../../shared/lib/use-unsaved';
import { ErrorMessage, Notice, Panel } from '../../shared/ui/ui';

export function StoragePanel({
  snapshot,
  versions = [],
}: {
  snapshot?: Snapshot;
  versions?: number[];
}) {
  const { api } = useApi();
  const command = useCommand();
  const [downloaded, setDownloaded] = useState(false);
  const raw = localStorage.getItem('courseos-demo-v1') || '{}';
  let recoveryCount = 0;
  try {
    const database = JSON.parse(raw);
    recoveryCount = Object.keys(database.recovery || {}).length;
  } catch {
    /* Исходная строка остаётся доступна даже при повреждённом JSON. */
  }
  if (api.mode !== 'demo') return null;
  return (
    <Panel title="Хранилище и история">
      <p>
        Данные хранятся в этом браузере. Занято примерно{' '}
        {((raw.length * 2) / 1024 / 1024).toFixed(2)} МБ; квота зависит от браузера (обычно около 5
        МБ). История не удаляется автоматически.
      </p>
      {versions.length > 0 && (
        <p>
          Сохранено версий: {versions.length}. При 15 и более версиях рекомендуем скачать архив.
          Утверждённые версии защищены от сокращения истории.
        </p>
      )}
      {recoveryCount > 0 && (
        <Notice tone="warning">
          Курсов, требующих восстановления: {recoveryCount}. Их исходные данные сохранены в архиве;
          остальные курсы доступны.
        </Notice>
      )}
      <button
        type="button"
        onClick={() => {
          saveFile(
            new Blob([raw], { type: 'application/json;charset=utf-8' }),
            'courseos-storage-archive.json',
          );
          setDownloaded(true);
        }}
      >
        Скачать исходные данные и всю историю
      </button>
      {snapshot && versions.length > 15 && (
        <button
          type="button"
          disabled={!downloaded || command.isPending}
          onClick={() => {
            if (
              window.confirm(
                'Архив скачан. Удалить старые неутверждённые версии, сохранив последние 15 и все утверждённые версии?',
              )
            )
              command.mutate({
                action: 'prune_history',
                expected_version: snapshot.course_version,
                payload: { keep_versions: versions.slice(-15), archive_saved: true },
              });
          }}
        >
          Сократить историю после скачивания архива
        </button>
      )}
      <ErrorMessage error={command.error} />
    </Panel>
  );
}
