import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useApi, useCourse } from '../../entities/course/api/provider';
import type { Material } from '../../entities/course/model/schema';
import { canonicalJson } from '../../shared/lib/decimal';
import { plural } from '../../shared/lib/plural';
import { Badge, Empty, ErrorMessage, Loading, Notice, Panel } from '../../shared/ui/ui';
import { changedSkeletonFields, compareAudits, diffLines } from './version-diff';
function materialText(material?: Material) {
  if (!material) return 'Материал отсутствует';
  return [
    material.content,
    material.expected && `Ожидаемый результат: ${material.expected}`,
    material.criteria.length && `Критерии:\n${material.criteria.join('\n')}`,
    ...material.questions.map(
      (q) =>
        `${q.text}\n${q.options.map((option, index) => `${index + 1}. ${option}`).join('\n')}\nКлюч: ${q.correct_index + 1}. ${q.explanation}`,
    ),
    ...material.slides.map(
      (slide) => `${slide.title}\n${slide.bullets.join('\n')}\n${slide.notes}`,
    ),
  ]
    .filter(Boolean)
    .join('\n\n');
}
export function ComparisonPage() {
  const current = useCourse();
  const { api } = useApi();
  const { courseId = '' } = useParams();
  const [search] = useSearchParams();
  const beforeVersion = Number(
    search.get('before') || current.data?.snapshot?.changes.at(-1)?.base_version || 1,
  );
  const before = useQuery({
    queryKey: [api.mode, 'course', courseId, beforeVersion],
    queryFn: () => api.get(courseId, beforeVersion),
    enabled: !!courseId,
  });
  if (current.isPending || before.isPending) return <Loading />;
  if (!current.data || !before.data) return <ErrorMessage error={current.error || before.error} />;
  const after = current.data.snapshot;
  const base = before.data.snapshot;
  if (!after || !base)
    return (
      <Empty title="Нет пары версий для сравнения">
        Сначала подготовьте материалы и примените согласованную правку.
      </Empty>
    );
  const change = after.changes.find(
    (c) => c.base_version === base.course_version && c.result_version === after.course_version,
  );
  const changed = after.materials.filter(
    (m) => base.materials.find((b) => b.id === m.id)?.hash !== m.hash,
  );
  const removed = base.materials.filter((m) => !after.materials.some((a) => a.id === m.id));
  const skeletonChanged = canonicalJson(base.skeleton) !== canonicalJson(after.skeleton);
  const approvalLabel = after.approval_applicable
    ? 'Утверждение применимо'
    : after.approvals.length
      ? 'Нужно новое утверждение'
      : 'Каркас ещё не утверждён';
  const skeletonFields = [
    ['requirements', 'Требования'],
    ['goal', 'Цель'],
    ['tasks', 'Задачи'],
    ['outcomes', 'Результаты обучения'],
    ['topics', 'Темы и часы'],
    ['activities', 'Учебные активности'],
    ['assessments', 'Оценивание'],
    ['explanations', 'Основания'],
    ['conflicts', 'Конфликты'],
    ['schema_version', 'Версия схемы'],
    ['normalization_version', 'Нормализация'],
    ['template_version', 'Шаблон'],
  ] as const;
  const skeletonChanges = changedSkeletonFields(base.skeleton, after.skeleton, skeletonFields);
  const audit = compareAudits(base.audit, after.audit);
  const auditChanged =
    base.audit.technical_ready !== after.audit.technical_ready ||
    audit.added.length > 0 ||
    audit.resolved.length > 0;
  const hasChanges = skeletonChanged || changed.length > 0 || removed.length > 0;
  const issuesLabel = (n: number) => `${n} ${plural(n, ['замечание', 'замечания', 'замечаний'])}`;
  const auditStatus = (snapshot: typeof after) =>
    `${snapshot.audit.technical_ready ? 'Технически полный черновик' : 'Нужна проверка'} · ${issuesLabel(snapshot.audit.issues.length)}`;
  return (
    <>
      <header className="page-heading">
        <h1>
          Версия {base.course_version} → {after.course_version}
        </h1>
        <p>
          {change
            ? `Причина: ${change.request}`
            : 'Причина появления новой версии не записана — сравнение по сохранённым версиям.'}
        </p>
      </header>
      <div className="readiness">
        <Badge tone={hasChanges ? 'amber' : 'neutral'}>
          {hasChanges ? 'Есть изменения' : 'Без изменений содержания'}
        </Badge>
        {base.skeleton_version !== after.skeleton_version && (
          <Badge>
            Ревизия каркаса: {base.skeleton_version} → {after.skeleton_version}
          </Badge>
        )}
        <Badge tone={after.approval_applicable ? 'green' : 'amber'}>{approvalLabel}</Badge>
      </div>
      {!hasChanges && !auditChanged && (
        <Panel>
          <p>
            Версия {after.course_version} совпадает с версией {base.course_version}: каркас,
            требования, материалы и результаты аудита ({issuesLabel(after.audit.issues.length)}) не
            изменились.
          </p>
        </Panel>
      )}
      {skeletonChanged && (
        <Panel title="Изменения каркаса и оснований">
          {skeletonChanges.map(({ key, label, lines }) => (
            <div className="diff-element" key={key}>
              <h3>{label}</h3>
              <ul className="diff-list">
                {lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ))}
          <Notice tone="warning">
            Изменились требования или план оценивания. Новая ревизия требует отдельного утверждения;
            обновление материалов выполняется после него.
          </Notice>
        </Panel>
      )}
      {(changed.length > 0 || removed.length > 0 || auditChanged) && (
        <Panel title="Фактические изменения">
          {auditChanged && (
            <div className="diff-element">
              <h3>Аудит</h3>
              <p>
                {auditStatus(base)} → {auditStatus(after)}
              </p>
              <ul className="diff-list">
                {audit.resolved.map((issue) => (
                  <li className="removed" key={issue.id}>
                    Закрыто: {issue.message}
                  </li>
                ))}
                {audit.added.map((issue) => (
                  <li className="added" key={issue.id}>
                    Новое: {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {changed.map((material) => {
            const old = base.materials.find((m) => m.id === material.id);
            return (
              <div className="diff-element" key={material.id}>
                <h3>{material.title}</h3>
                <small>
                  {material.id} ·{' '}
                  {change?.affected_ids.includes(material.id)
                    ? 'В согласованном плане влияния'
                    : 'Проверьте основание изменения'}
                </small>
                <pre className="line-diff">
                  {diffLines(materialText(old), materialText(material)).map((line, index) => (
                    <span className={line.kind} key={index}>
                      {line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '− ' : '  '}
                      {line.text}
                      {'\n'}
                    </span>
                  ))}
                </pre>
              </div>
            );
          })}
          {removed.map((material) => (
            <div className="diff-element" key={material.id}>
              <h3>Удалён материал: {material.title}</h3>
              <pre>{material.content}</pre>
            </div>
          ))}
        </Panel>
      )}
      {change && change.preserved.length > 0 && (
        <Panel
          title="Сохранность незатронутых элементов"
          subtitle="Проверка всех объявленных незатронутыми ID и SHA-256 содержимого."
        >
          {change.preserved.map((item) => {
            const old = base.materials.find((m) => m.id === item.id);
            const actual = after.materials.find((m) => m.id === item.id);
            const equal = !!old && !!actual && old.hash === actual.hash && item.equal;
            return (
              <div className="preserved-row" key={item.id}>
                <div>
                  <strong>{actual?.title || item.id}</strong>
                  <small>
                    {item.id}
                    {actual?.manual ? ' · ручная правка сохранена' : ''}
                  </small>
                  <code>{actual?.hash}</code>
                </div>
                <Badge tone={equal ? 'green' : 'red'}>
                  {equal ? 'Содержание совпадает' : 'Расхождение'}
                </Badge>
                <Link
                  to={`/courses/${courseId}/materials?version=${base.course_version}&material=${item.id}`}
                >
                  До ↗
                </Link>
                <Link
                  to={`/courses/${courseId}/materials?version=${after.course_version}&material=${item.id}`}
                >
                  После ↗
                </Link>
              </div>
            );
          })}
        </Panel>
      )}
      <div className="actions">
        <Link
          className="button primary"
          to={`/courses/${courseId}/${after.approval_applicable ? 'materials' : 'plan'}`}
        >
          {after.approval_applicable
            ? 'Открыть материалы'
            : after.approvals.length
              ? 'Утвердить новую ревизию'
              : 'Утвердить программу'}
        </Link>
        <Link className="button" to={`/courses/${courseId}/audit`}>
          Повторный аудит
        </Link>
        <Link className="button" to={`/courses/${courseId}/materials?tab=exports`}>
          Выгрузки новой версии
        </Link>
      </div>
    </>
  );
}
