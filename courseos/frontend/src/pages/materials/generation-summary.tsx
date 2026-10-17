import type { Generation } from '../../entities/course/model/schema';
import { generationCost } from '../../entities/course/model/content-generation';
import { Badge, Panel } from '../../shared/ui/ui';

const rubles = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const integers = new Intl.NumberFormat('ru-RU');

// Что сделала модель после утверждения: расход для расчёта стоимости программы,
// несгенерированные части и замечания самопроверки, которые методисту нужно разобрать.
export function GenerationSummary({ generation }: { generation: Generation }) {
  const { tokens, cost_rub } = generationCost(generation);
  const seconds = generation.calls.reduce((sum, call) => sum + call.duration_ms, 0) / 1000;
  const review = generation.review;
  return (
    <Panel
      className="generation-summary"
      title="Материалы написаны моделью"
      subtitle={`${generation.calls.length} вызовов GigaChat · ${integers.format(tokens)} токенов · ${rubles.format(cost_rub)} ₽ · ${rubles.format(seconds)} с работы модели`}
    >
      {generation.failed.length > 0 && (
        <>
          <h3>Не сгенерировано — остались заготовки</h3>
          <ul>
            {generation.failed.map((failure) => (
              <li key={failure}>{failure}</li>
            ))}
          </ul>
        </>
      )}
      {generation.issues.length > 0 && (
        <>
          <h3>Исправлено кодом в ответах модели</h3>
          <ul>
            {generation.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </>
      )}
      <h3>Самопроверка</h3>
      {!review ? (
        <p>Самопроверка не выполнена.</p>
      ) : (
        <>
          <p>{review.summary || 'Замечаний нет.'}</p>
          {review.issues.length > 0 && (
            <ul>
              {review.issues.map((issue) => (
                <li key={`${issue.element}-${issue.message}`}>
                  <Badge
                    tone={issue.resolved ? 'green' : issue.severity === 'error' ? 'red' : 'amber'}
                  >
                    {issue.resolved
                      ? 'Исправлено агентом'
                      : issue.severity === 'error'
                        ? 'Ошибка'
                        : 'Проверить'}
                  </Badge>{' '}
                  <strong>{issue.element}.</strong> {issue.message}
                  {issue.fix && !issue.resolved && <> Предложение: {issue.fix}</>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}
