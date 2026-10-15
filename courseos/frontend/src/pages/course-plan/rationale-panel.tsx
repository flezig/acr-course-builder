import type { Snapshot } from '../../entities/course/model/schema';
import {
  currentRationales,
  missingBasis,
  rationaleCoverage,
  rationaleIsSupported,
  rationaleSignature,
  skeletonElements,
  sourceById,
  skeletonRationaleMarkdown,
} from '../../entities/course/model/rationale';
import { saveFile } from '../../shared/lib/use-unsaved';
import { Badge, Panel } from '../../shared/ui/ui';

export function RationalePanel({ snapshot }: { snapshot: Snapshot }) {
  const s = snapshot.skeleton;
  const signature = rationaleSignature(s);
  const coverage = rationaleCoverage(s);
  return (
    <Panel
      title="Основания каждого элемента"
      subtitle={`Сохранённая версия ${snapshot.course_version} · ревизия ${snapshot.skeleton_version} · ${snapshot.mode}`}
    >
      <p>
        Подтверждено: {coverage.confirmed}; эксперт/пилот: {coverage.expert}; допущения:{' '}
        {coverage.assumptions}; пробелы и устаревшие основания: {coverage.gaps}. Наличие связи не
        подтверждает её смысл.
      </p>
      <button
        onClick={() =>
          saveFile(
            new Blob([skeletonRationaleMarkdown(snapshot)], {
              type: 'text/markdown;charset=utf-8',
            }),
            `${snapshot.course_id}-v${snapshot.course_version}-rationale.md`,
          )
        }
      >
        Скачать основания этой версии · MD
      </button>
      <details>
        <summary>Все элементы и их основания</summary>
        {skeletonElements(s).map((e) => (
          <details key={e.id} id={`basis-${e.id}`}>
            <summary>
              {e.title} · {e.id}
            </summary>
            <p>{e.decision}</p>
            <p>Связи: {e.related.join(', ') || 'не заданы'}</p>
            {!currentRationales(s, e.id, signature).length && <p>{missingBasis}</p>}
            {currentRationales(s, e.id, signature).map((r) => {
              const source = sourceById(s, r.source_id);
              return (
                <article key={r.id}>
                  <Badge>
                    {r.kind} · {r.status} · v{r.version}
                  </Badge>
                  <p>
                    Этап:{' '}
                    {r.phase === 'design'
                      ? 'использовано при проектировании'
                      : 'последующая методическая проверка'}
                  </p>
                  <p>Сохранённое решение: {r.decision}</p>
                  <p>Зачем: {r.purpose}</p>
                  <p>
                    Источник:{' '}
                    {r.source_id === 'request'
                      ? 'Запрос этой версии'
                      : source?.name || missingBasis}
                    . Доступ: {source?.provenance?.access || 'не установлен'}. Содержание:{' '}
                    {source?.provenance?.content || 'не проверено'}.
                  </p>
                  <p>Фрагмент: {r.fragment || missingBasis}</p>
                  <p>Координаты: {r.coordinate || 'не заданы'}</p>
                  <p>Применимость: {r.applicability}</p>
                  <p>Альтернативы: {r.alternatives}</p>
                  <p>Доверие: {r.trust}</p>
                  <p>Ограничения: {r.limitations}</p>
                  <p>
                    Проверено: {r.verification} {r.reviewer} {r.checked_at}
                  </p>
                  <p>Далее: {r.next_check}</p>
                  {!rationaleIsSupported(s, r, signature) && <p>{missingBasis}</p>}
                </article>
              );
            })}
          </details>
        ))}
      </details>
      <details>
        <summary>Идентичность сохранённого состояния</summary>
        <code>
          {snapshot.course_id} · v{snapshot.course_version} · SHA-256: {snapshot.skeleton_hash}
        </code>
      </details>
    </Panel>
  );
}
