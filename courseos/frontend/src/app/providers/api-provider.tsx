import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DemoCourseApi } from '../../entities/course/api/demo-course-api';
import { HttpCourseApi } from '../../entities/course/api/http-course-api';
import { CourseApiProvider } from '../../entities/course/api/provider';
import type { CourseApi } from '../../entities/course/api/contract';
import { config } from '../../shared/config/config';
import { ApiError } from '../../shared/api/http';
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => count < 1 && error instanceof ApiError && error.status >= 500,
      staleTime: 1000,
    },
    mutations: { retry: false },
  },
});
export function ApiProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<'demo' | 'live'>(() => {
    const stored = localStorage.getItem('courseos-mode');
    return stored === 'demo' || stored === 'live' ? stored : config.mode;
  });
  const [api, setApi] = useState<CourseApi>(() =>
    mode === 'demo' ? new DemoCourseApi() : new HttpCourseApi(config.apiUrl),
  );
  const setMode = (next: 'demo' | 'live') => {
    localStorage.setItem('courseos-mode', next);
    setModeState(next);
    setApi(next === 'demo' ? new DemoCourseApi() : new HttpCourseApi(config.apiUrl));
  };
  return (
    <QueryClientProvider client={queryClient}>
      <CourseApiProvider api={api} setMode={setMode}>
        {children}
      </CourseApiProvider>
    </QueryClientProvider>
  );
}
