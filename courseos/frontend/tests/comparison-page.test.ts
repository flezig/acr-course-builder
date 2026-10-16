import { afterEach, expect, it, vi } from 'vitest';
import { DemoCourseApi } from '../src/entities/course/api/demo-course-api';
import { presets } from '../src/entities/course/model/presets';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CourseApiProvider } from '../src/entities/course/api/provider';
import { ComparisonPage } from '../src/pages/comparison/page';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('выгрузки из сравнения открывают выбранную историческую версию', async () => {
  vi.useFakeTimers();
  const stored = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
  vi.stubGlobal('navigator', {});
  const api = new DemoCourseApi();
  const created = await api.command({
    action: 'start',
    request_id: crypto.randomUUID(),
    payload: structuredClone(presets.find((preset) => preset.id === 'python')!.requirements),
  });
  vi.advanceTimersByTime(500);
  const skeleton = (await api.get(created.course_id)).snapshot!;
  await api.command({
    action: 'approve',
    course_id: created.course_id,
    expected_version: skeleton.course_version,
    request_id: crypto.randomUUID(),
    payload: { skeleton_version: skeleton.skeleton_version, skeleton_hash: skeleton.skeleton_hash },
  });
  vi.advanceTimersByTime(2500);
  const snapshot = (await api.get(created.course_id)).snapshot!;
  await api.command({
    action: 'audit',
    course_id: snapshot.course_id,
    expected_version: snapshot.course_version,
    request_id: crypto.randomUUID(),
    payload: {},
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  const selectedVersion = snapshot.course_version;
  queryClient.setQueryData(
    ['demo', 'course', snapshot.course_id, 'latest'],
    await api.get(snapshot.course_id),
  );
  for (const version of [1, selectedVersion])
    queryClient.setQueryData(
      ['demo', 'course', snapshot.course_id, version],
      await api.get(snapshot.course_id, version),
    );
  const html = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(CourseApiProvider, {
        api,
        setMode: () => {},
        children: createElement(
          MemoryRouter,
          {
            initialEntries: [
              `/courses/${snapshot.course_id}/compare?before=1&after=${selectedVersion}`,
            ],
          },
          createElement(
            Routes,
            null,
            createElement(Route, {
              path: '/courses/:courseId/compare',
              element: createElement(ComparisonPage),
            }),
          ),
        ),
      }),
    ),
  );
  expect(html).toContain(
    `href="/courses/${snapshot.course_id}/materials?version=${selectedVersion}&amp;tab=exports"`,
  );
  const exported = JSON.parse(
    await (await api.exportJson(snapshot.course_id, selectedVersion)).text(),
  );
  expect(exported.course_version).toBe(selectedVersion);
  expect((await api.get(snapshot.course_id)).latest_version).toBeGreaterThan(selectedVersion);
  queryClient.clear();
});
