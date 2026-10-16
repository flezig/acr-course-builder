import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Trash2 } from 'lucide-react';
import {
  useApi,
  useCommand,
  useCourses,
  useDeleteCourse,
} from '../../entities/course/api/provider';
import { inputSchema, type Requirements } from '../../entities/course/model/schema';
import { emptyRequirements, presets } from '../../entities/course/model/presets';
import { StoragePanel } from '../../features/export-course/storage-panel';
import { parameterDiscrepancies } from '../../entities/course/model/request-parameters';
import { CreateReferences } from './create-references';
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
  const exampleRequest = presets.find((p) => p.id === presetId)?.requirements.request;
  const changedRequest = values.request !== exampleRequest;
  const discrepancies = parameterDiscrepancies(values);
  useEffect(() => {
    setConfirmed(false);
  }, [values.request]);
  const submit = form.handleSubmit(async (values) => {
    if (discrepancies.length || (api.mode === 'demo' && changedRequest && !confirmed)) {
      if (parametersRef.current) parametersRef.current.open = true;
      setConfirmationError(
        discrepancies.length
          ? 'Устраните расхождения текста и сводки.'
          : 'Сверьте и подтвердите параметры. В демо изменённый запрос не анализируется моделью.',
      );
      return;
    }
    try {
      const title = values.title.trim() || values.request.trim().split('\n')[0].slice(0, 80);
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
    form.reset(structuredClone(presets.find((p) => p.id === id)!.requirements));
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
        <Panel
          className="create-request"
          title="Опишите будущую программу"
          subtitle="Опишите тему, аудиторию и ограничения своими словами. Остальное уточним."
        >
          <Field label="Запрос методиста">
            <textarea
              {...form.register('request')}
              rows={4}
              placeholder="Для кого курс, чему нужно научить, сколько часов и какие ограничения важно учесть?"
            />
          </Field>
          <details className="parameter-summary" ref={parametersRef}>
            <summary>Сводка параметров</summary>
            <p>
              {api.mode === 'demo'
                ? 'Значения примера можно изменить вручную. Демо не анализирует изменённый запрос; сверьте все поля с текстом.'
                : 'Проверьте параметры перед отправкой на сервер.'}
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
            {api.mode === 'demo' && changedRequest && (
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
          <CreateReferences
            references={form.watch('references')}
            onChange={(value) => form.setValue('references', value, { shouldDirty: true })}
          />
          <ErrorMessage error={command.error} />
          <div className="create-submit">
            <button className="primary" disabled={command.isPending} type="submit">
              {command.isPending ? 'Запрос сохраняется…' : 'Отправить запрос'}
              <ArrowRight size={18} />
            </button>
            <small>Вы сможете проверить и изменить программу перед утверждением</small>
          </div>
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
        <Panel title="Ваши сохранённые курсы">
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
                  aria-label={`Удалить курс «${course.title}»`}
                  title="Удалить курс"
                  disabled={deleteCourse.isPending}
                  onClick={() => {
                    if (window.confirm(`Удалить курс «${course.title}» со всеми версиями?`))
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
      <StoragePanel />
      <ErrorMessage error={courses.error} />
      <ErrorMessage error={deleteCourse.error} />
    </div>
  );
}
