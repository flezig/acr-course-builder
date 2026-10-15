import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useApi, useCommand, useCourses } from '../../entities/course/api/provider';
import { inputSchema, type Requirements } from '../../entities/course/model/schema';
import { emptyRequirements, presets } from '../../entities/course/model/presets';
import { ReferenceEditor } from '../../features/upload-reference/reference-editor';
import { Form, Badge, ErrorMessage, Field, Panel, statuses } from '../../shared/ui/ui';
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
    const subscription = form.watch((value) => {
      localStorage.setItem(`courseos-create-draft-${api.mode}`, JSON.stringify(value));
    });
    return () => subscription.unsubscribe();
  }, [form, api.mode]);
  const submit = form.handleSubmit(async (values) => {
    try {
      // Отдельного поля названия нет: до уточнений курс подписан началом запроса.
      const title = values.title.trim() || values.request.trim().split('\n')[0].slice(0, 80);
      const result = await command.mutateAsync({
        action: 'start',
        payload: { ...values, title },
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
          <ReferenceEditor
            uploadOnly
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
