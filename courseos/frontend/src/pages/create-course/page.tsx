import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, BookOpen, Sparkles, Check } from 'lucide-react';
import { useApi, useCommand, useCourses } from '../../entities/course/api/provider';
import { inputSchema, type Requirements } from '../../entities/course/model/schema';
import { emptyRequirements, presets } from '../../entities/course/model/presets';
import { ReferenceEditor } from '../../features/upload-reference/reference-editor';
import { Badge, ErrorMessage, Field, Notice, Panel, statuses } from '../../shared/ui/ui';
import { useUnsavedChanges } from '../../shared/lib/use-unsaved';
import './create-course.css';
export function CreateCoursePage() {
  const { api } = useApi();
  const command = useCommand();
  const courses = useCourses();
  const navigate = useNavigate();
  const [presetId, setPresetId] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  const form = useForm<Requirements>({
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
    const subscription = form.watch((value) => {
      localStorage.setItem(`courseos-create-draft-${api.mode}`, JSON.stringify(value));
    });
    return () => subscription.unsubscribe();
  }, [form, api.mode]);
  const submit = form.handleSubmit(async (values) => {
    try {
      const result = await command.mutateAsync({ action: 'start', payload: values });
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
    form.reset(structuredClone(presets.find((p) => p.id === id)!.requirements));
    formRef.current?.querySelector('.create-request')?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      block: 'start',
    });
  };
  const fillFromText = () => {
    const request = form.getValues('request');
    const hours = request.match(/(\d+(?:[.,]\d+)?)\s*(?:час|ч\b)/i);
    if (hours) form.setValue('total_hours', hours[1].replace(',', '.'), { shouldDirty: true });
    if (/общеразвивающ/i.test(request))
      form.setValue('template_id', 'acr_general', { shouldDirty: true });
    else if (/повышени.*квалификац/i.test(request))
      form.setValue('template_id', 'acr_professional', { shouldDirty: true });
  };
  return (
    <div className="create-workspace">
      <header className="page-heading create-heading">
        <div className="eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО МЕТОДИСТА</div>
        <h1>От запроса к проверяемой программе</h1>
        <p>Проверьте результаты, последовательность, часы и оценивание до создания материалов.</p>
      </header>
      <form ref={formRef} onSubmit={submit} className="create-layout">
        <Panel
          className="create-request"
          title="Опишите будущую программу"
          subtitle="Начните с темы и аудитории. Остальное уточним."
        >
          <Field label="Запрос методиста">
            <textarea
              {...form.register('request')}
              rows={4}
              placeholder="Для кого курс, чему нужно научить, сколько часов и какие ограничения важно учесть?"
            />
          </Field>
          <div className="form-grid">
            <Field label="Название / ИТ-тема">
              <input {...form.register('title')} placeholder="Например, основы веб-разработки" />
            </Field>
            <Field label="Аудитория">
              <input {...form.register('audience')} placeholder="Кто будет учиться?" required />
            </Field>
          </div>
          {Object.values(form.formState.errors).length > 0 && (
            <Notice tone="error">
              {form.formState.errors.title?.message ||
                form.formState.errors.total_hours?.message ||
                'Проверьте введённые поля.'}
            </Notice>
          )}
          <ErrorMessage error={command.error} />
          <div className="create-submit">
            <button className="primary" disabled={command.isPending} type="submit">
              {command.isPending ? 'Запрос сохраняется…' : 'Отправить запрос'}
              <ArrowRight size={18} />
            </button>
            <small>Далее — уточнения недостающих данных или создание каркаса.</small>
          </div>
        </Panel>
        <section className="examples" aria-labelledby="examples-title">
          <h2 id="examples-title">Начните с примера</h2>
          <p id="examples-hint">Выбор заполнит поля. Их можно изменить до отправки.</p>
          <small className="examples-source">Демонстрационные сценарии</small>
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
                <span className="example-icon" aria-hidden="true">
                  {presetId === p.id ? <Check size={18} /> : <BookOpen size={18} />}
                </span>
                <span className="example-copy">
                  <strong>{p.label}</strong>
                  <small>{p.description}</small>
                </span>
              </button>
            ))}
          </div>
        </section>
        <Panel
          className="create-parameters"
          title="Параметры программы"
          subtitle="Заполните то, что уже известно. Пробелы уточним до каркаса."
        >
          <button type="button" className="link-button" onClick={fillFromText}>
            <Sparkles size={15} /> Перенести явно указанные часы и тип из текста
          </button>
          <div className="form-grid">
            <Field label="Тип программы">
              <select {...form.register('template_id')}>
                <option value="unknown">Уточнить перед каркасом</option>
                <option value="acr_general">Общеразвивающая</option>
                <option value="acr_professional">Повышение квалификации</option>
              </select>
            </Field>
            <Field label="Входной уровень">
              <input {...form.register('entry_level')} placeholder="Можно оставить для уточнения" />
            </Field>
            <Field label="Объём, часы" hint="От 16 до 500; поддерживаются дробные часы">
              <input {...form.register('total_hours')} inputMode="decimal" placeholder="72" />
            </Field>
            <Field label="Форма обучения">
              <input {...form.register('delivery')} placeholder="Очно, смешанно, стажировка…" />
            </Field>
          </div>
          <Field label="Цель">
            <textarea
              {...form.register('goal')}
              rows={2}
              placeholder="Какое действие сможет выполнить слушатель?"
            />
          </Field>
          <div className="form-grid">
            <Field label="Итоговая аттестация">
              <input {...form.register('assessment')} placeholder="Проект, экзамен, портфолио…" />
            </Field>
            <Field label="Срок / календарь">
              <input
                {...form.register('calendar.description')}
                placeholder="Если нет точных дат — уточним"
              />
            </Field>
          </div>
          <Field label="Дополнительные ограничения">
            <textarea
              {...form.register('constraints')}
              rows={2}
              placeholder="Минимум практики, инструменты, данные, ограничения нагрузки"
            />
          </Field>
          <details>
            <summary>Даты и учебная нагрузка</summary>
            <div className="form-grid">
              <Field label="Начало">
                <input type="date" {...form.register('calendar.start')} />
              </Field>
              <Field label="Календарных дней">
                <input
                  type="number"
                  min="0"
                  {...form.register('calendar.calendar_days', { valueAsNumber: true })}
                />
              </Field>
              <Field label="Максимум часов в учебный день">
                <input {...form.register('calendar.daily_limit')} inputMode="decimal" />
              </Field>
            </div>
            <label className="checkbox">
              <input type="checkbox" {...form.register('calendar.weekdays_only')} /> Учиться только
              по будням
            </label>
            <label className="checkbox">
              <input type="checkbox" {...form.register('calendar.same_units')} /> Объём и дневная
              нагрузка указаны в одинаковых единицах
            </label>
            <label className="checkbox">
              <input type="checkbox" {...form.register('calendar.confirmed')} /> Даты и учебные дни
              подтверждены методистом
            </label>
          </details>
        </Panel>
        <Panel
          className="create-references"
          title="Референсы и основания"
          subtitle="Сохраните требования, прошлую программу или полезный фрагмент."
        >
          <ReferenceEditor
            references={form.watch('references')}
            onChange={(value) => form.setValue('references', value, { shouldDirty: true })}
          />
        </Panel>
        <aside className="create-guidance">
          <Panel title="Сначала каркас">
            <ol className="steps">
              <li className="current">
                <b>01</b>
                <div>
                  <strong>Запрос и уточнения</strong>
                  <p>Только недостающие параметры</p>
                </div>
              </li>
              <li>
                <b>02</b>
                <div>
                  <strong>Пять объяснений</strong>
                  <p>Основания, расчёты и ограничения</p>
                </div>
              </li>
              <li>
                <b>03</b>
                <div>
                  <strong>Ваше утверждение</strong>
                  <p>Конкретная ревизия каркаса</p>
                </div>
              </li>
              <li>
                <b>04</b>
                <div>
                  <strong>Согласованный комплект</strong>
                  <p>Материалы, проверка и правки</p>
                </div>
              </li>
            </ol>
            <div className="template-choice">
              <small>ОБРАЗЕЦ АЦР</small>
              <strong>
                {form.watch('template_id') === 'unknown'
                  ? 'Выберем после уточнения типа'
                  : form.watch('template_id') === 'acr_general'
                    ? 'Общеразвивающая программа'
                    : 'Повышение квалификации'}
              </strong>
              <p>
                Основание выбора — указанный тип программы. Числа исходного образца не используются
                как настройки.
              </p>
            </div>
          </Panel>
        </aside>
      </form>
      <p className="create-caption">
        CourseOS помогает собрать проверяемый каркас и комплект программы. Решения и утверждение
        остаются за методистом.
      </p>
      {!!courses.data?.length && (
        <Panel title="Ваши сохранённые курсы">
          <div className="course-list">
            {courses.data.map((course) => (
              <button
                className="course-row"
                key={course.course_id}
                onClick={() => navigate(`/courses/${course.course_id}/plan`)}
              >
                <div>
                  <strong>{course.title}</strong>
                  <small>
                    {course.total_hours || 'Объём уточняется'} ч · версия {course.latest_version} ·{' '}
                    {course.course_id.slice(0, 8)}
                  </small>
                </div>
                <Badge>{statuses[course.status]}</Badge>
                <ArrowRight size={18} />
              </button>
            ))}
          </div>
        </Panel>
      )}
      <ErrorMessage error={courses.error} />
    </div>
  );
}
