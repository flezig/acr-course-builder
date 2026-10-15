import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useApi, useCourse } from '../../entities/course/api/provider';
import type { Material } from '../../entities/course/model/schema';
import { canonicalJson } from '../../shared/lib/decimal';
import { plural } from '../../shared/lib/plural';
import { Badge, Empty, ErrorMessage, Loading, Notice } from '../../shared/ui/ui';
import { changedSkeletonFields, compareAudits, diffLines, foldUnchanged } from './version-diff';
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
  if (base.course_version === after.course_version)
    return (
      <Empty title={`Выбрана та же версия ${after.course_version}`}>
        Сравнивать версию с самой собой бессмысленно.{' '}
        {after.course_version > 1 && (
          <Link to={`/courses/${courseId}/compare?before=${after.course_version - 1}`}>
            Сравнить с версией {after.course_version - 1}
          </Link>
        )}
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
  const preserved = (change?.preserved ?? []).map((item) => {
    const old = base.materials.find((m) => m.id === item.id);
    const actual = after.materials.find((m) => m.id === item.id);
    return { item, actual, equal: !!old && !!actual && old.hash === actual.hash && item.equal };
  });
  // Расхождения показываем первыми: ради них раздел и существует.
  preserved.sort((a, b) => Number(a.equal) - Number(b.equal));
  // Расхождения видны всегда, совпавшие сверх первых пяти убраны под раскрытие.
  const preservedVisible = preserved.filter((row, index) => !row.equal || index < 5);
  const preservedHidden = preserved.filter((row) => !preservedVisible.includes(row));
  const preservedRow = ({ item, actual, equal }: (typeof preserved)[number]) => (
    <div className="compare-preserved" key={item.id}>
      <span className={equal ? 'ok' : 'broken'} aria-hidden>
        {equal ? '✓' : '!'}
      </span>
      <strong>{actual?.title || item.id}</strong>
      <small title={actual?.hash ? `SHA-256: ${actual.hash}` : undefined}>
        {item.id}
        {actual?.manual ? ' · ручная правка сохранена' : ''}
        {!equal && ' · содержание расходится'}
      </small>
      <span className="compare-links">
        <Link to={materialsLink(base.course_version, item.id)}>До ↗</Link>
        <Link to={materialsLink(after.course_version, item.id)}>После ↗</Link>
      </span>
    </div>
  );
  const preservedBroken = preserved.filter((row) => !row.equal).length;
  const issuesDelta = after.audit.issues.length - base.audit.issues.length;
  const materialsLink = (version: number, id: string) =>
    `/courses/${courseId}/materials?version=${version}&material=${id}`;
  return (
    <div className="compare-page">
      <header className="compare-hero">
        <div>
          <h1>
            Версия {base.course_version} → {after.course_version}
          </h1>
          <p>
            {change
              ? `Причина: ${change.request}`
              : 'Причина появления новой версии не записана — сравнение по сохранённым версиям.'}
            {!hasChanges &&
              !auditChanged &&
              ` Содержание версии ${after.course_version} совпадает с версией ${base.course_version}.`}
          </p>
        </div>
        <div className="compare-cta">
          <Badge tone={after.approval_applicable ? 'green' : 'amber'}>{approvalLabel}</Badge>
          <div className="actions">
            <Link className="button" to={`/courses/${courseId}/audit`}>
              Повторный аудит
            </Link>
            <Link className="button" to={`/courses/${courseId}/materials?tab=exports`}>
              Выгрузки новой версии
            </Link>
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
          </div>
        </div>
      </header>

      <section className="compare-kpis" aria-label="Сводка изменений">
        <div className={`compare-kpi ${changed.length ? 'accent' : ''}`}>
          <b>{changed.length}</b>
          <span>
            {plural(changed.length, [
              'материал изменён',
              'материала изменено',
              'материалов изменено',
            ])}
          </span>
        </div>
        <div className={`compare-kpi ${removed.length ? 'danger' : ''}`}>
          <b>{removed.length}</b>
          <span>
            {plural(removed.length, ['материал удалён', 'материала удалено', 'материалов удалено'])}
          </span>
        </div>
        <div className={`compare-kpi ${preservedBroken ? 'danger' : ''}`}>
          <b>
            {preserved.length ? `${preserved.length - preservedBroken}/${preserved.length}` : '—'}
          </b>
          <span>
            {preserved.length
              ? 'незатронутых элементов совпадают'
              : 'перечень незатронутых элементов не задан'}
          </span>
        </div>
        <div className="compare-kpi">
          <b>
            {after.audit.issues.length}
            {issuesDelta !== 0 && (
              <small className={issuesDelta < 0 ? 'better' : 'worse'}>
                {issuesDelta < 0 ? '↓' : '↑'}
                {Math.abs(issuesDelta)}
              </small>
            )}
          </b>
          <span>
            {plural(after.audit.issues.length, ['замечание', 'замечания', 'замечаний'])} аудита
            {issuesDelta !== 0 && ` (было ${base.audit.issues.length})`}
          </span>
        </div>
      </section>

      <section className="compare-sections">
        <details open={changed.length + removed.length > 0}>
          <summary>
            Материалы
            <span className={`compare-count ${changed.length + removed.length ? '' : 'ok'}`}>
              {changed.length + removed.length
                ? `${changed.length + removed.length} ${plural(changed.length + removed.length, ['изменение', 'изменения', 'изменений'])}`
                : 'без изменений'}
            </span>
          </summary>
          {changed.map((material) => {
            const old = base.materials.find((m) => m.id === material.id);
            const planned = change?.affected_ids.includes(material.id);
            return (
              <article className="compare-material" key={material.id}>
                <h3>
                  {old ? material.title : `Новый материал: ${material.title}`}
                  <Badge tone={planned ? 'green' : 'amber'}>
                    {planned ? 'В согласованном плане' : 'Вне плана — проверьте основание'}
                  </Badge>
                </h3>
                <small>{material.id}</small>
                <div className="line-diff">
                  {foldUnchanged(diffLines(materialText(old), materialText(material))).map(
                    (block, blockIndex) =>
                      block.kind === 'fold' ? (
                        <details className="line-fold" key={blockIndex}>
                          <summary>
                            ⋯ {block.lines.length}{' '}
                            {plural(block.lines.length, ['строка', 'строки', 'строк'])} без
                            изменений
                          </summary>
                          {block.lines.map((line, index) => (
                            <div className="same" key={index}>
                              {line.text || ' '}
                            </div>
                          ))}
                        </details>
                      ) : (
                        block.lines.map((line, index) => (
                          <div className={line.kind} key={`${blockIndex}-${index}`}>
                            {line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '− ' : '  '}
                            {line.text}
                          </div>
                        ))
                      ),
                  )}
                </div>
              </article>
            );
          })}
          {removed.map((material) => (
            <article className="compare-material" key={material.id}>
              <h3>
                Удалён материал: {material.title}
                <Badge tone="red">Удалён</Badge>
              </h3>
              <small>{material.id}</small>
              <div className="line-diff">
                {material.content.split('\n').map((line, index) => (
                  <div className="removed" key={index}>
                    − {line}
                  </div>
                ))}
              </div>
            </article>
          ))}
          {!changed.length && !removed.length && (
            <p className="compare-empty">Содержимое материалов не изменилось.</p>
          )}
        </details>

        <details open={auditChanged}>
          <summary>
            Аудит
            <span className={`compare-count ${audit.added.length ? 'warn' : 'ok'}`}>
              {auditChanged
                ? [
                    audit.resolved.length && `${audit.resolved.length} закрыто`,
                    audit.added.length && `${audit.added.length} новых`,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'изменился статус'
                : 'без изменений'}
            </span>
          </summary>
          <p className="compare-empty">
            {auditStatus(base)} → {auditStatus(after)}
          </p>
          {auditChanged && (
            <div className="compare-pills">
              {audit.resolved.map((issue) => (
                <span className="compare-pill resolved" key={issue.id}>
                  ✓ Закрыто: {issue.message}
                </span>
              ))}
              {audit.added.map((issue) => (
                <span className="compare-pill added" key={issue.id}>
                  Новое: {issue.message}
                </span>
              ))}
              {!audit.added.length && <span className="compare-pill">Новых замечаний нет</span>}
            </div>
          )}
        </details>

        <details open={skeletonChanged}>
          <summary>
            Каркас и основания
            <span className={`compare-count ${skeletonChanged ? 'warn' : 'ok'}`}>
              {skeletonChanged
                ? `${skeletonChanges.length} ${plural(skeletonChanges.length, ['раздел', 'раздела', 'разделов'])}`
                : 'без изменений'}
            </span>
            {base.skeleton_version !== after.skeleton_version && (
              <span className="compare-count">
                ревизия {base.skeleton_version} → {after.skeleton_version}
              </span>
            )}
          </summary>
          {skeletonChanges.map(({ key, label, lines }) => (
            <div className="compare-skeleton-field" key={key}>
              <h3>{label}</h3>
              <ul>
                {lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ))}
          {skeletonChanged ? (
            <Notice tone="warning">
              Изменились требования или план оценивания. Новая ревизия требует отдельного
              утверждения; обновление материалов выполняется после него.
            </Notice>
          ) : (
            <p className="compare-empty">Каркас и требования не изменились.</p>
          )}
        </details>

        {preserved.length > 0 && (
          <details open={preservedBroken > 0}>
            <summary>
              Незатронутые элементы
              <span className={`compare-count ${preservedBroken ? 'danger' : 'ok'}`}>
                {preservedBroken
                  ? `${preservedBroken} с расхождением`
                  : `${preserved.length} из ${preserved.length} совпадают`}
              </span>
            </summary>
            {preservedVisible.map(preservedRow)}
            {preservedHidden.length > 0 && (
              <details className="compare-more">
                <summary>
                  Показать ещё {preservedHidden.length}{' '}
                  {plural(preservedHidden.length, ['элемент', 'элемента', 'элементов'])}
                </summary>
                {preservedHidden.map(preservedRow)}
              </details>
            )}
            <p className="compare-note">
              Проверка по ID и SHA-256 содержимого; хеш виден при наведении на ID.
            </p>
          </details>
        )}
      </section>
    </div>
  );
}
