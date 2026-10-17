import type { Generation } from '../../entities/course/model/schema';
import { generationCost } from '../../entities/course/model/content-generation';
import { useCommand } from '../../entities/course/api/provider';
import { Badge, ErrorMessage, Panel } from '../../shared/ui/ui';

const rubles = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const integers = new Intl.NumberFormat('ru-RU');

// Что сделала модель после утверждения: расход для расчёта стоимости программы,
// несгенерированные части и замечания самопроверки, которые методисту нужно разобрать.
export function GenerationSummary({
  generation,
  reviewCurrent,
  courseVersion,
}: {
  generation: Generation;
  reviewCurrent: boolean;
  courseVersion: number;
}) {
  const command = useCommand();
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
      {!!generation.source_checks?.length && (
        <>
          <h3>Проверка ссылок модели</h3>
          <ul>
            {generation.source_checks.map((check, index) => (
              <li key={index}>
                <a href={check.original_url} target="_blank" rel="noreferrer">
                  {check.original_url}
                </a>{' '}
                · {check.checked_at}
                <br />
                Доступность: {check.availability === 'available' ? 'доступна' : 'недоступна'}; HTTP{' '}
                {check.http_status ?? 'нет ответа'}. Конечный URL: {check.final_url}
                <p>Утверждение: {check.claim}</p>
                <p>{check.reason}</p>
                {check.excerpt && <blockquote>{check.excerpt}</blockquote>}
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>Самопроверка</h3>
      <button
        disabled={command.isPending}
        onClick={() =>
          void command
            .mutateAsync({
              action: 'review_materials',
              expected_version: courseVersion,
              payload: {},
            })
            .catch(() => {})
        }
      >
        {command.isPending ? 'Проверяем материалы…' : 'Повторить самопроверку текущих материалов'}
      </button>
      <ErrorMessage error={command.error} />
      {!review ? (
        <p>Самопроверка не выполнена.</p>
      ) : (
        <>
          <p>
            {reviewCurrent
              ? 'Проверка выполнена для текущих материалов.'
              : 'Проверка неполная или устарела.'}{' '}
            {review.summary}
          </p>
          <p>
            Серьёзные замечания блокируют готовность. Откройте очередь решений в плане программы,
            проверьте материал и сохраните решение с обоснованием. Переписывание вопроса агентом не
            закрывает замечание.
          </p>
          {review.issues.length > 0 && (
            <ul>
              {review.issues.map((issue) => (
                <li key={`${issue.element}-${issue.message}`}>
                  <Badge tone={issue.severity === 'error' ? 'red' : 'amber'}>
                    {issue.severity === 'error' ? 'Ошибка — нужно решение методиста' : 'Проверить'}
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
