import { Link } from 'react-router-dom';
import type { Snapshot } from '../../entities/course/model/schema';
import { assessmentLabels } from '../../entities/course/model/presets';
import { Panel } from '../../shared/ui/ui';

// Кейс требует для каждого результата хотя бы одну тему и два разных оценочных средства.
const requiredAssessments = 2;

export function CoverageMatrix({ snapshot, planHref }: { snapshot: Snapshot; planHref: string }) {
  const skeleton = snapshot.skeleton;
  const study = skeleton.topics.filter((topic) => topic.id !== 'topic-final');
  return (
    <Panel
      title="Покрытие результатов"
      subtitle="Результат × темы × оценочные средства. Непокрытое ведёт к находке в очереди решений."
      className="coverage-panel"
    >
      <div
        className="table-scroll"
        id="coverage"
        tabIndex={0}
        role="region"
        aria-label="Покрытие результатов"
      >
        <table className="coverage-matrix">
          <thead>
            <tr>
              <th>Результат</th>
              <th>Темы</th>
              <th>Оценочные средства</th>
            </tr>
          </thead>
          <tbody>
            {skeleton.outcomes.map((outcome, index) => {
              const topics = study.filter((topic) => topic.outcome_ids.includes(outcome.id));
              const assessments = skeleton.assessments.filter((a) =>
                a.outcome_ids.includes(outcome.id),
              );
              const types = new Set(assessments.map((a) => a.type));
              const gap = !topics.length || types.size < requiredAssessments;
              const issue = snapshot.audit.issues.find((item) => item.element_id === outcome.id);
              return (
                <tr key={outcome.id} className={gap ? 'coverage-gap' : undefined}>
                  <th scope="row">
                    <small>Результат {index + 1}</small>
                    {outcome.title || outcome.description}
                  </th>
                  <td>
                    <strong className={topics.length ? undefined : 'gap-count'}>
                      темы: {topics.length}
                    </strong>
                    <span>{topics.map((topic) => topic.title).join(', ')}</span>
                  </td>
                  <td>
                    {gap && issue ? (
                      <Link className="gap-count" to={`${planHref}#issue-${issue.id}`}>
                        средства: {types.size} из {requiredAssessments}
                      </Link>
                    ) : (
                      <strong>
                        средства: {types.size} из {requiredAssessments}
                      </strong>
                    )}
                    <span>{assessments.map((a) => assessmentLabels[a.type]).join(', ')}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
