import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowUp, Check, Loader2, ChevronDown, Trash2 } from 'lucide-react';
import {
  useApi,
  useCommand,
  useCourses,
  useDeleteCourse,
} from '../../entities/course/api/provider';
import {
  inputSchema,
  type ClarifyingQuestion,
  type ModelDesign,
  type Requirements,
} from '../../entities/course/model/schema';
import { emptyRequirements, presets } from '../../entities/course/model/presets';
import { missingQuestions } from '../../entities/course/model/factory';
import { parameterDiscrepancies } from '../../entities/course/model/request-parameters';
import { CreateReferences } from './create-references';
import { useDictation } from '../../features/voice-input/use-dictation';
import { DictationButton } from '../../features/voice-input/dictation-button';
import {
  describeUsage,
  useModelAvailability,
  useRequestAnalysis,
  useClarifyingQuestions,
  useSkeletonDraft,
  type RequestAnalysis,
} from '../../features/model-steps/model-steps';
import { ProfessionalStandardFields } from '../../features/professional-standard/professional-standard-fields';
import { isProfessionalStandardReference } from '../../entities/course/model/professional-standards';
import { contentHash } from '../../shared/lib/decimal';
import { Form, Badge, ErrorMessage, Field, Notice, Panel, statuses } from '../../shared/ui/ui';
import { useUnsavedChanges } from '../../shared/lib/use-unsaved';
import './create-course.css';
export function CreateCoursePage() {
  const { api } = useApi();
  const command = useCommand();
  const courses = useCourses();
  const deleteCourse = useDeleteCourse();
  const navigate = useNavigate();
  const [presetId, setPresetId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [confirmationError, setConfirmationError] = useState('');
  const modelAvailable = useModelAvailability().data === true;
  const analysis = useRequestAnalysis();
  const clarifyingQuestions = useClarifyingQuestions();
  const skeletonDraft = useSkeletonDraft();
  const modelStep = clarifyingQuestions.isPending
    ? 'GigaChat готовит уточняющие вопросы по содержанию запроса…'
    : skeletonDraft.isPending
      ? 'GigaChat проектирует каркас: цель, результаты обучения, модули и темы. Часы распределит программа. Обычно это занимает 10–20 секунд.'
      : '';
  const modelError = clarifyingQuestions.error ?? skeletonDraft.error;
  // После сбоя модели методист может осознанно построить каркас по шаблону.
  // Ref, а не состояние: повторная отправка идёт сразу, до следующего рендера.
  const withoutModel = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const parametersRef = useRef<HTMLDetailsElement>(null);
  const form = useForm<Requirements>({
    mode: 'onChange',
    resolver: zodResolver(inputSchema),
    defaultValues: (() => {
      try {
        return (
          JSON.parse(localStorage.getItem(`courseos-create-draft-${api.mode}`) || 'null') ||
          emptyRequirements
        );
      } catch {
        return emptyRequirements;
      }
    })(),
  });
  const dictation = useDictation({
    getText: () => form.getValues('request'),
    setText: (text) => form.setValue('request', text, { shouldDirty: true, shouldValidate: true }),
  });
  const allowNavigation = useUnsavedChanges(form.formState.isDirty && !command.isSuccess);
  useEffect(() => {
    const subscription = form.watch((value, { name }) => {
      if (name && name !== 'parameters_confirmation' && value.parameters_confirmation) {
        form.setValue('parameters_confirmation', undefined);
        return;
      }
      localStorage.setItem(`courseos-create-draft-${api.mode}`, JSON.stringify(value));
    });
    return () => subscription.unsubscribe();
  }, [form, api.mode]);
  const values = form.watch();
  const exampleRequest = presets.find((p) => p.id === (presetId || values.demo_example))
    ?.requirements.request;
  const changedRequest = values.request !== exampleRequest;
  const discrepancies = parameterDiscrepancies(values);
  // Короткая выжимка в свёрнутом заголовке: методист видит главное, не раскрывая форму.
  const parameterPreview = [
    { acr_general: 'Общеразвивающая', acr_professional: 'Повышение квалификации' }[
      values.template_id as 'acr_general' | 'acr_professional'
    ],
    values.total_hours && `${values.total_hours} ч`,
    values.calendar.calendar_days > 0 &&
      `${Math.round((values.calendar.calendar_days / 7) * 10) / 10} нед.`,
    values.delivery.trim(),
  ]
    .filter(Boolean)
    .join(' · ');
  useEffect(() => {
    setConfirmed(false);
    withoutModel.current = false;
  }, [values.request]);
  // Своё описание сначала разбирает модель: первое нажатие «Отправить» заполняет
  // и раскрывает сводку, второе — подтверждает её. Модель только предлагает значения,
  // методист сверяет их сам; после сбоя поля можно заполнить вручную и отправить снова.
  const reviewWithModel = modelAvailable && api.mode === 'demo' && changedRequest;
  const awaitingConfirmation = reviewWithModel && analysis.variables === values.request;
  const fillSummary = async (request: string) => {
    if (parametersRef.current) parametersRef.current.open = true;
    let result: RequestAnalysis;
    try {
      result = await analysis.mutateAsync(request);
    } catch {
      return; /* Ошибка показывается под полем запроса, поля остаются как были. */
    }
    if (form.getValues('request') !== request) return;
    const { parameters } = result;
    const options = { shouldDirty: true, shouldValidate: true };
    for (const field of [
      'title',
      'template_id',
      'audience',
      'entry_level',
      'goal',
      'total_hours',
      'delivery',
      'assessment',
      'constraints',
    ] as const)
      form.setValue(field, parameters[field], options);
    form.setValue('calendar.daily_limit', parameters.daily_limit, options);
    if (parameters.weeks) form.setValue('calendar.calendar_days', Math.round(parameters.weeks * 7));
    form.setValue('calendar.confirmed', false);
    setConfirmationError('');
  };
  const analyzedCurrentRequest = analysis.isSuccess && analysis.variables === values.request;
  const submit = form.handleSubmit(async (values) => {
    dictation.stop();
    if (reviewWithModel && analysis.variables !== values.request)
      return fillSummary(values.request);
    if (
      discrepancies.length ||
      (api.mode === 'demo' && changedRequest && !reviewWithModel && !confirmed)
    ) {
      if (parametersRef.current) parametersRef.current.open = true;
      setConfirmationError(
        discrepancies.length
          ? 'Устраните расхождения текста и сводки.'
          : 'Сверьте и подтвердите параметры. В демо изменённый запрос не анализируется моделью.',
      );
      return;
    }
    const title = values.title.trim() || values.request.trim().split('\n')[0].slice(0, 80);
    // Для своего запроса агент сначала задаёт вопросы по содержанию. Если вопросов нет
    // и сводка полная, каркас проектируется сразу; иначе — после ответов на шаге уточнений.
    // Примеры остаются детерминированными и модель не вызывают.
    let modelQuestions: ClarifyingQuestion[] | undefined;
    let modelDesign: ModelDesign | undefined;
    if (modelAvailable && api.mode === 'demo' && changedRequest && !withoutModel.current) {
      try {
        const summary = { ...values, title };
        modelQuestions = await clarifyingQuestions.mutateAsync(summary);
        if (!modelQuestions.length && !missingQuestions(summary).length)
          modelDesign = await skeletonDraft.mutateAsync(summary);
      } catch {
        return; /* Ошибка и выбор «без модели» показываются под полем запроса. */
      }
    }
    try {
      const confirmation =
        values.parameters_confirmation?.request === values.request
          ? values.parameters_confirmation
          : { request: values.request, actor: 'methodist', at: new Date().toISOString() };
      // Сохраняем дату до отправки: повтор после сетевого сбоя должен иметь тот же payload.
      form.setValue('parameters_confirmation', confirmation);
      const result = await command.mutateAsync({
        action: 'start',
        payload: {
          ...values,
          demo_example: api.mode === 'demo' && !changedRequest ? values.demo_example : undefined,
          clarification_answers: undefined,
          title,
          references: await Promise.all(
            values.references.map(async (reference) => {
              if (reference.hash) return reference;
              const source = {
                ...reference,
                name:
                  reference.name.trim() ||
                  (reference.id.startsWith('useful-link-')
                    ? 'Полезная ссылка'
                    : 'Прошлая программа'),
                url: reference.url.trim(),
              };
              return { ...source, hash: await contentHash({ text: source.text, url: source.url }) };
            }),
          ),
          parameters_confirmation: confirmation,
          model_design: modelDesign,
          model_questions: modelQuestions,
          calendar: {
            ...values.calendar,
            description: `${values.calendar.calendar_days} календарных дней (${values.calendar.calendar_days / 7} нед.); ${values.calendar.daily_limit ? `до ${values.calendar.daily_limit} ч/день` : 'дневная нагрузка уточняется'}`,
          },
        },
      });
      localStorage.removeItem(`courseos-create-draft-${api.mode}`);
      form.reset(emptyRequirements);
      allowNavigation();
      navigate(`/courses/${result.course_id}/plan`);
    } catch {
      /* Ошибка отображается рядом с действием; черновик сохраняется. */
    }
  });
  const choose = (id: string) => {
    setPresetId(id);
    setConfirmationError('');
    analysis.reset();
    clarifyingQuestions.reset();
    skeletonDraft.reset();
    withoutModel.current = false;
    form.reset({
      ...structuredClone(presets.find((p) => p.id === id)!.requirements),
      demo_example: id as Requirements['demo_example'],
    });
    formRef.current?.querySelector('.create-request')?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
      block: 'start',
    });
  };
  return (
    <div className="create-workspace">
      <header className="page-heading create-heading">
        <h1>Создайте учебную программу</h1>
        <p>
          Опишите задачу — CourseOS предложит структуру, распределение часов и способы проверки
          знаний
        </p>
      </header>
      <Form
        errors={form.formState.errors}
        submitCount={form.formState.submitCount}
        ref={formRef}
        onSubmit={submit}
        className="create-layout"
      >
        <Panel className="create-request" title="Какую программу создаём?">
          <Field label="Запрос методиста" className="request-composer">
            <textarea
              {...form.register('request')}
              rows={4}
              placeholder="Для кого курс, чему нужно научить, сколько часов и какие ограничения важно учесть? Остальное уточним."
            />
            <CreateReferences
              references={values.references}
              onChange={(value) => form.setValue('references', value, { shouldDirty: true })}
              sendButton={
                <>
                  <DictationButton dictation={dictation} />
                  <button
                    className={`send-request ${values.request.trim() ? 'ready' : ''}`}
                    disabled={command.isPending || analysis.isPending || !!modelStep}
                    type="submit"
                    aria-label={
                      awaitingConfirmation
                        ? 'Подтвердить параметры и создать программу'
                        : 'Отправить запрос'
                    }
                    title={
                      analysis.isPending || modelStep
                        ? 'GigaChat работает над запросом…'
                        : command.isPending
                          ? 'Запрос сохраняется…'
                          : awaitingConfirmation
                            ? 'Подтвердить параметры и создать программу'
                            : 'Отправить запрос'
                    }
                  >
                    {command.isPending || analysis.isPending || modelStep ? (
                      <Loader2 className="spin" size={18} />
                    ) : awaitingConfirmation ? (
                      <Check size={18} />
                    ) : (
                      <ArrowUp size={18} />
                    )}
                  </button>
                </>
              }
            />
          </Field>
          {dictation.error && <Notice tone="error">{dictation.error}</Notice>}
          {modelStep && <Notice>{modelStep}</Notice>}
          {modelError && (
            <div className="request-analysis">
              <ErrorMessage error={modelError} />
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  withoutModel.current = true;
                  clarifyingQuestions.reset();
                  skeletonDraft.reset();
                  formRef.current?.requestSubmit();
                }}
              >
                Построить каркас по шаблону без модели
              </button>
            </div>
          )}
          {analysis.isPending && <Notice>GigaChat заполняет сводку параметров по запросу…</Notice>}
          {analyzedCurrentRequest && analysis.data && !modelStep && (
            <div className="request-analysis">
              <Notice tone="warning">
                <p>
                  <strong>Проверьте сводку параметров ниже.</strong> GigaChat заполнил её по запросу
                  и мог ошибиться. Исправьте поля, если нужно, и нажмите кнопку ✓ справа в поле
                  запроса — это подтвердит параметры и создаст программу.
                </p>
                {analysis.data.corrections.map((correction) => (
                  <p key={correction}>{correction}</p>
                ))}
                {!!analysis.data.parameters.missing.length && (
                  <p>
                    Не хватает: {analysis.data.parameters.missing.join('; ')}. Заполните поля сейчас
                    или ответьте на вопросы агента после отправки.
                  </p>
                )}
                <small>{describeUsage(analysis.data.usage)}</small>
              </Notice>
            </div>
          )}
          {analysis.isError && analysis.variables === values.request && (
            <div className="request-analysis">
              <ErrorMessage error={analysis.error} />
              <Notice>Заполните сводку параметров ниже вручную и отправьте запрос ещё раз.</Notice>
            </div>
          )}
          <details className="parameter-summary" ref={parametersRef}>
            <summary>
              <span className="parameter-summary-heading">
                <span>Сводка параметров</span>
                <small>{parameterPreview || 'Заполнится по тексту запроса'}</small>
              </span>
              <ChevronDown size={18} aria-hidden="true" />
            </summary>
            <p>
              {api.mode !== 'demo'
                ? 'Проверьте параметры перед отправкой на сервер.'
                : analyzedCurrentRequest
                  ? 'Поля заполнены GigaChat по тексту запроса. Модель могла ошибиться: сверьте каждое значение.'
                  : reviewWithModel && analysis.variables
                    ? 'Текст запроса изменился. При отправке GigaChat заново заполнит поля по новому тексту.'
                    : reviewWithModel
                      ? 'После отправки GigaChat заполнит поля по тексту запроса. Их можно заполнить и вручную.'
                      : 'Значения примера можно изменить вручную. Демо не анализирует изменённый запрос; сверьте все поля с текстом.'}
            </p>
            <div className="form-grid">
              <Field label="Название программы">
                <input {...form.register('title')} />
              </Field>
              <Field label="Тип программы">
                <select {...form.register('template_id')}>
                  <option value="unknown">Уточнить</option>
                  <option value="acr_general">Общеразвивающая</option>
                  <option value="acr_professional">Повышение квалификации</option>
                </select>
              </Field>
              <Field label="Аудитория">
                <input {...form.register('audience')} />
              </Field>
              <Field label="Входной уровень">
                <input {...form.register('entry_level')} />
              </Field>
              <Field label="Объём в часах">
                <input inputMode="decimal" {...form.register('total_hours')} />
              </Field>
              <Field label="Форма обучения">
                <input {...form.register('delivery')} />
              </Field>
              <Field label="Срок в неделях">
                <input
                  type="number"
                  min="0"
                  max="521"
                  step="0.142857142857"
                  value={values.calendar.calendar_days / 7}
                  onChange={(e) => {
                    form.setValue(
                      'calendar.calendar_days',
                      Math.round(Number(e.target.value) * 7),
                      { shouldDirty: true },
                    );
                    form.setValue('calendar.confirmed', false);
                  }}
                />
              </Field>
              <Field label="Дата начала">
                <input type="date" {...form.register('calendar.start')} />
              </Field>
              <Field label="Максимум часов в день">
                <input inputMode="decimal" {...form.register('calendar.daily_limit')} />
              </Field>
              <Field label="Итоговая аттестация">
                <input {...form.register('assessment')} />
              </Field>
            </div>
            <Field label="Цель">
              <textarea {...form.register('goal')} rows={2} />
            </Field>
            <Field label="Ограничения">
              <textarea {...form.register('constraints')} rows={2} />
            </Field>
            <ProfessionalStandardFields
              reference={values.references.find(isProfessionalStandardReference)}
              onChange={(reference) =>
                form.setValue(
                  'references',
                  [
                    ...values.references.filter(
                      (source) => !isProfessionalStandardReference(source),
                    ),
                    ...(reference ? [reference] : []),
                  ],
                  { shouldDirty: true },
                )
              }
            />
            {!!discrepancies.length && (
              <Notice tone="warning">{discrepancies.join(' ')} Исправьте текст или поля.</Notice>
            )}
            {api.mode === 'demo' && changedRequest && !reviewWithModel && (
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => {
                    setConfirmed(e.target.checked);
                    setConfirmationError('');
                  }}
                />
                Подтверждаю параметры изменённого запроса вручную
              </label>
            )}
            {confirmationError && <Notice tone="error">{confirmationError}</Notice>}
          </details>
          <ErrorMessage error={command.error} />
          <small className="create-submit-hint">
            Вы сможете проверить и изменить программу перед утверждением
          </small>
        </Panel>
        <section className="examples" aria-labelledby="examples-title">
          <h2 id="examples-title">Попробуйте на примере</h2>
          <p id="examples-hint">
            Выберите пример, чтобы заполнить запрос. Затем измените его под свою задачу
          </p>
          <div className="example-grid">
            {presets.map((p) => (
              <button
                type="button"
                className={`example ${presetId === p.id ? 'selected' : ''}`}
                key={p.id}
                aria-pressed={presetId === p.id}
                aria-describedby="examples-hint"
                onClick={() => choose(p.id)}
              >
                <span className="example-topic" aria-hidden="true">
                  {
                    { python: 'PY', teachers: 'ИИ', bank: 'DATA', security: 'SEC', devops: 'OPS' }[
                      p.id
                    ]
                  }
                </span>
                <span className="example-copy">
                  <strong>{p.label}</strong>
                  <small>{p.description}</small>
                </span>
              </button>
            ))}
          </div>
        </section>
      </Form>
      {!!courses.data?.length && (
        <Panel title="Ваши программы">
          <div className="course-list">
            {courses.data.map((course) => (
              <div className="course-item" key={course.course_id}>
                <button
                  className="course-row"
                  onClick={() => navigate(`/courses/${course.course_id}/plan`)}
                >
                  <div>
                    <strong>{course.title}</strong>
                    <small>
                      {course.total_hours || 'Объём уточняется'} ч · версия {course.latest_version}{' '}
                      · {course.course_id.slice(0, 8)}
                    </small>
                  </div>
                  <Badge>{statuses[course.status]}</Badge>
                  <ArrowRight size={18} />
                </button>
                <button
                  className="course-delete"
                  aria-label={`Удалить программу «${course.title}»`}
                  title="Удалить программу"
                  disabled={deleteCourse.isPending}
                  onClick={() => {
                    if (window.confirm(`Удалить программу «${course.title}» со всеми версиями?`))
                      deleteCourse.mutate(course.course_id);
                  }}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
          </div>
        </Panel>
      )}
      <ErrorMessage error={courses.error} />
      <ErrorMessage error={deleteCourse.error} />
    </div>
  );
}
