import { useEffect, useRef, useState } from 'react';
import { X, Link2, Check } from 'lucide-react';
import type { Skeleton, Snapshot } from '../../entities/course/model/schema';
import { useCommand } from '../../entities/course/api/provider';
import { Form, ErrorMessage } from '../../shared/ui/ui';
import { buildMap, type MapNode } from './map-model';

export type LinkRequest = {
  node: MapNode;
  target: 'requirement' | 'topic' | 'activity' | 'assessment' | 'outcome';
};
const labels = {
  requirement: 'Требование',
  topic: 'Темы',
  activity: 'Практика',
  assessment: 'Оценивание',
  outcome: 'Результаты',
};

export function MapLinkEditor({
  snapshot,
  request,
  close,
  edit,
  onSaved,
}: {
  snapshot: Snapshot;
  request: LinkRequest;
  close: () => void;
  edit?: () => void;
  onSaved?: (before: Skeleton, version: number) => void;
}) {
  const { nodes, edges } = buildMap(snapshot.skeleton);
  const [target, setTarget] = useState(request.target);
  const [chosen, setChosen] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      Object.keys(labels).map((prefix) => [
        prefix,
        nodes
          .filter(
            (n) =>
              n.id.startsWith(`${prefix}:`) &&
              edges.some(
                (e) =>
                  (e.from === n.id && e.to === request.node.id) ||
                  (e.to === n.id && e.from === request.node.id),
              ),
          )
          .map((n) => n.sourceId),
      ]),
    ),
  );
  const initialChosen = useRef(chosen);
  const changes = Object.keys(labels).flatMap((prefix) => {
    const before = initialChosen.current[prefix];
    const after = chosen[prefix];
    return [
      ...after
        .filter((id) => !before.includes(id))
        .map((id) => ({ id: `${prefix}:${id}`, action: 'Добавить' })),
      ...before
        .filter((id) => !after.includes(id))
        .map((id) => ({ id: `${prefix}:${id}`, action: 'Убрать' })),
    ];
  });
  const dialog = useRef<HTMLDialogElement>(null);
  const command = useCommand();
  const options = nodes.filter((n) => n.id.startsWith(`${target}:`));
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus({ preventScroll: true });
    };
  }, []);
  async function save() {
    const skeleton = structuredClone(snapshot.skeleton);
    if (request.node.column === 1) {
      const id = request.node.sourceId;
      const outcome = skeleton.outcomes.find((o) => o.id === id)!;
      outcome.requirement_id = chosen.requirement[0] || '';
      for (const [prefix, collection] of [
        ['topic', skeleton.topics],
        ['activity', skeleton.activities],
        ['assessment', skeleton.assessments],
      ] as const) {
        for (const item of collection)
          item.outcome_ids = chosen[prefix].includes(item.id)
            ? [...new Set([...item.outcome_ids, id])]
            : item.outcome_ids.filter((o) => o !== id);
      }
    } else if (request.node.column === 0) {
      for (const o of skeleton.outcomes) {
        if (chosen.outcome.includes(o.id)) o.requirement_id = request.node.sourceId;
        else if (o.requirement_id === request.node.sourceId) o.requirement_id = '';
      }
    } else {
      const collection = request.node.id.startsWith('topic:')
        ? skeleton.topics
        : request.node.id.startsWith('activity:')
          ? skeleton.activities
          : skeleton.assessments;
      const item = collection.find((n) => n.id === request.node.sourceId)!;
      item.outcome_ids = chosen.outcome;
    }
    try {
      await command.mutateAsync({
        action: 'save_skeleton',
        expected_version: snapshot.course_version,
        payload: skeleton,
      });
      onSaved?.(snapshot.skeleton, snapshot.course_version + 1);
      close();
    } catch {
      /* Keep the choices visible if saving fails. */
    }
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby="map-link-title"
      className="map-link-dialog"
      onCancel={(e) => {
        e.preventDefault();
        if (!command.isPending) close();
      }}
    >
      <Form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="details-topline">
          <span>
            <Link2 size={17} />
            {request.node.column === 1
              ? 'Изменить связи результата'
              : 'Изменить связанные результаты'}
          </span>
          <button
            type="button"
            className="map-close"
            aria-label="Закрыть настройку связей"
            disabled={command.isPending}
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        <h2 id="map-link-title">{request.node.originalTitle}</h2>
        <p className="muted">
          {request.node.column === 1
            ? 'Выберите элементы, связанные с этим результатом.'
            : 'Выберите результаты, связанные с этим объектом.'}
        </p>
        {request.node.column === 1 && (
          <div className="map-link-tabs" aria-label="Тип связи">
            {(['requirement', 'topic', 'activity', 'assessment'] as const).map((key) => (
              <button
                type="button"
                key={key}
                aria-pressed={target === key}
                onClick={() => setTarget(key)}
              >
                {labels[key]} <span>{chosen[key].length}</span>
              </button>
            ))}
          </div>
        )}
        <fieldset disabled={command.isPending}>
          <legend>
            {labels[target]}
            {target !== 'requirement' && ' · можно выбрать несколько'}
          </legend>
          <div className="map-link-options">
            {options.map((n) => (
              <label key={n.id}>
                <input
                  type={target === 'requirement' ? 'radio' : 'checkbox'}
                  name="map-link-choice"
                  checked={chosen[target].includes(n.sourceId)}
                  onChange={(e) =>
                    setChosen((prev) => ({
                      ...prev,
                      [target]:
                        target === 'requirement'
                          ? [n.sourceId]
                          : e.target.checked
                            ? [...prev[target], n.sourceId]
                            : prev[target].filter((id) => id !== n.sourceId),
                    }))
                  }
                />
                <span>
                  <small>{n.type}</small>
                  {n.description}
                </span>
              </label>
            ))}
            {!options.length && (
              <p className="map-link-empty">
                В каркасе пока нет объектов этого типа. Добавьте их в редакторе каркаса.
              </p>
            )}
          </div>
        </fieldset>
        {target === 'requirement' && chosen.requirement.length > 0 && (
          <button
            type="button"
            className="map-inline-action"
            onClick={() => setChosen((prev) => ({ ...prev, requirement: [] }))}
          >
            Убрать связь с требованием
          </button>
        )}
        <section className="link-change-preview" aria-label="Предпросмотр изменений связей">
          <h3>Изменения связей · {changes.length}</h3>
          {changes.length ? (
            <ul>
              {changes.map((change) => (
                <li key={change.id}>
                  {change.action}: {nodes.find((n) => n.id === change.id)?.title}
                </li>
              ))}
            </ul>
          ) : (
            <p>Связи остаются прежними. Выберите элементы, чтобы подготовить изменение.</p>
          )}
          <p>
            Текущая версия: {Object.values(initialChosen.current).flat().length} связей.
            Предложенная: {Object.values(chosen).flat().length} связей.
          </p>
        </section>
        <p className="map-link-note">
          Связи сохранятся в новой ревизии. Утверждение программы потребует отдельной проверки.
        </p>
        <ErrorMessage error={command.error} />
        <div className="map-link-actions">
          <button type="button" disabled={command.isPending} onClick={close}>
            Отмена
          </button>
          {!options.length && edit && (
            <button type="button" onClick={edit}>
              Открыть редактор каркаса
            </button>
          )}
          <button className="primary" type="submit" disabled={command.isPending || !changes.length}>
            <Check size={15} />
            {command.isPending ? 'Сохраняем…' : 'Сохранить связи'}
          </button>
        </div>
      </Form>
    </dialog>
  );
}
