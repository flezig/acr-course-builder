import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useApi, useCourse } from '../../entities/course/api/provider';
import type { Material } from '../../entities/course/model/schema';
import { canonicalJson } from '../../shared/lib/decimal';
import { Badge, Empty, ErrorMessage, Loading, Notice, Panel } from '../../shared/ui/ui';
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
  return (
    <>
      <header className="page-heading">
        <div className="eyebrow">COURSE REVISION · ФАКТИЧЕСКОЕ СРАВНЕНИЕ</div>
        <h1>
          Версия {base.course_version} → {after.course_version}
        </h1>
        <p>{change?.request || 'Сравнение содержимого сохранённых snapshots'}</p>
      </header>
      <div className="readiness">
        <Badge tone="green">
          {skeletonChanged || changed.length || removed.length
            ? 'Есть изменения'
            : 'Каркас и материалы без изменений'}
        </Badge>
        <Badge>
          Ревизия каркаса: {base.skeleton_version} → {after.skeleton_version}
        </Badge>
        <Badge tone={after.approval_applicable ? 'green' : 'amber'}>{approvalLabel}</Badge>
      </div>
      <Panel title={skeletonChanged ? 'Изменения каркаса и оснований' : 'Каркас и основания'}>
        {!skeletonChanged && <p>Каркас и требования не изменились.</p>}
        {skeletonFields
          .filter(
            ([key]) => canonicalJson(base.skeleton[key]) !== canonicalJson(after.skeleton[key]),
          )
          .map(([key, label]) => (
            <div className="diff-element" key={key}>
              <h3>{label}</h3>
              <div className="diff-grid">
                <div>
                  <span>ДО · R{base.skeleton_version}</span>
                  <pre>{JSON.stringify(base.skeleton[key], null, 2)}</pre>
                </div>
                <div>
                  <span>ПОСЛЕ · R{after.skeleton_version}</span>
                  <pre>{JSON.stringify(after.skeleton[key], null, 2)}</pre>
                </div>
              </div>
            </div>
          ))}
      </Panel>
      <Panel title="Фактические изменения">
        <div className="diff-grid">
          <div>
            <span>АУДИТ ДО · V{base.course_version}</span>
            <p>
              {base.audit.technical_ready ? 'Технически полный черновик' : 'Нужна проверка'} ·{' '}
              {base.audit.issues.length} замечаний
            </p>
          </div>
          <div>
            <span>АУДИТ ПОСЛЕ · V{after.course_version}</span>
            <p>
              {after.audit.technical_ready ? 'Технически полный черновик' : 'Нужна проверка'} ·{' '}
              {after.audit.issues.length} замечаний
            </p>
          </div>
        </div>
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
              <div className="diff-grid">
                <div>
                  <span>ДО</span>
                  <pre>{materialText(old)}</pre>
                </div>
                <div>
                  <span>ПОСЛЕ</span>
                  <pre>{materialText(material)}</pre>
                </div>
              </div>
            </div>
          );
        })}
        {skeletonChanged && (
          <Notice tone="warning">
            Изменились требования или план оценивания. Новая ревизия требует отдельного утверждения;
            обновление материалов выполняется после него.
          </Notice>
        )}
        {removed.map((material) => (
          <div className="diff-element" key={material.id}>
            <h3>Удалён материал: {material.title}</h3>
            <pre>{material.content}</pre>
          </div>
        ))}
        {!changed.length && !removed.length && <p>Содержимое материалов не изменилось.</p>}
      </Panel>
      <Panel
        title="Сохранность незатронутых элементов"
        subtitle="Проверка всех объявленных незатронутыми ID и SHA-256 содержимого."
      >
        {change?.preserved.map((item) => {
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
        }) || <p>План не содержал перечня незатронутых элементов.</p>}
      </Panel>
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
