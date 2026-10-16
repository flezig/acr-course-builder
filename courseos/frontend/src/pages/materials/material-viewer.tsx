import { Link } from 'react-router-dom';
import { LockKeyhole } from 'lucide-react';
import type { Material, Snapshot } from '../../entities/course/model/schema';
import { materialLabels } from '../../entities/course/model/presets';
import { Badge, Notice } from '../../shared/ui/ui';
import { ElementEditor } from './element-editor';
export function MaterialViewer({
  material,
  snapshot,
  readonly,
}: {
  material: Material;
  snapshot: Snapshot;
  readonly: boolean;
}) {
  const versionParam = snapshot.course_version;
  return (
    <article className="material-viewer">
      <div className="toolbar">
        <Badge tone="green">{materialLabels[material.type]}</Badge>
        {material.manual && (
          <Badge>
            <LockKeyhole size={12} />
            Ручная правка защищена
          </Badge>
        )}
        {!readonly && !material.stale && (
          <ElementEditor
            material={material}
            snapshot={snapshot}
            type={
              ['seminar', 'project', 'portfolio', 'exam', 'mentor_interview'].includes(
                material.type,
              )
                ? 'assignment'
                : 'material'
            }
            targetId={material.id}
          />
        )}
      </div>
      <h2>{material.title}</h2>
      {material.stale && (
        <Notice tone="warning">
          Ожидает обновления после нового утверждения. Содержание относится к прежней структуре
          программы.
        </Notice>
      )}
      <pre className="material-content">{material.content}</pre>
      {material.test_policy && (
        <p>
          Вопросов: {material.questions.length}; порог: {material.test_policy.pass_count} верных
          ответов.
        </p>
      )}
      {material.datasets?.map((dataset) => (
        <details key={dataset.name}>
          <summary>
            Учебные данные: {dataset.name} ({dataset.rows.length} строк)
          </summary>
          <p>{dataset.description}</p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {dataset.columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataset.rows.map((row, index) => (
                  <tr key={index}>
                    {row.map((value, cell) => (
                      <td key={cell}>{value ?? 'NULL'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
      <div className="material-context">
        <div>
          <h4>Результаты обучения</h4>
          {material.outcome_ids.map((id) => (
            <Link key={id} to={`/courses/${snapshot.course_id}/map?version=${versionParam}#${id}`}>
              {snapshot.skeleton.outcomes.find((o) => o.id === id)?.description || id} ↗
            </Link>
          ))}
        </div>
        <div>
          <h4>Ожидаемый результат</h4>
          <p>{material.expected}</p>
          <h4>Критерии</h4>
          <ul>
            {material.criteria.map((criterion, index) => (
              <li key={index}>{criterion}</li>
            ))}
          </ul>
        </div>
      </div>
      {material.questions.length > 0 && (
        <div className="questions">
          <h3>{material.questions.length} вопросов с ключами и объяснениями</h3>
          {material.questions.map((question, index) => (
            <section className="question" key={question.id} id={question.id}>
              <div className="question-number">{String(index + 1).padStart(2, '0')}</div>
              <div>
                <h3>{question.text}</h3>
                {!readonly && !material.stale && (
                  <ElementEditor
                    material={material}
                    snapshot={snapshot}
                    type="question"
                    targetId={question.id}
                  />
                )}
                <ol type="A">
                  {question.options.map((option, i) => (
                    <li className={i === question.correct_index ? 'correct-option' : ''} key={i}>
                      {option}
                      {i === question.correct_index && <Badge tone="green">Верный ответ</Badge>}
                    </li>
                  ))}
                </ol>
                <p>
                  <b>Объяснение:</b> {question.explanation}
                </p>
                <small>{question.outcome_ids.join(', ')}</small>
              </div>
            </section>
          ))}
        </div>
      )}
      {material.slides.length > 0 && (
        <div className="slides">
          <h3>Содержание слайдов и пояснения преподавателя</h3>
          {material.slides.map((slide, index) => (
            <div className="slide" key={slide.id}>
              <span>СЛАЙД {index + 1}</span>
              <h3>{slide.title}</h3>
              {!readonly && !material.stale && (
                <ElementEditor
                  material={material}
                  snapshot={snapshot}
                  type="slide"
                  targetId={slide.id}
                />
              )}
              <ul>
                {slide.bullets.map((bullet, i) => (
                  <li key={i}>{bullet}</li>
                ))}
              </ul>
              <div className="slide-notes">
                <b>Пояснения преподавателя</b>
                <p>{slide.notes}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
