import { createContext, useContext, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import type { CommandEnvelope, CourseApi, CourseCommand } from './contract';
import { ApiError } from '../../../shared/api/http';
import { canonicalJson } from '../../../shared/lib/decimal';
const ApiContext = createContext<{
  api: CourseApi;
  setMode: (mode: 'demo' | 'live') => void;
} | null>(null);
export function CourseApiProvider({
  api,
  setMode,
  children,
}: {
  api: CourseApi;
  setMode: (mode: 'demo' | 'live') => void;
  children: ReactNode;
}) {
  return <ApiContext.Provider value={{ api, setMode }}>{children}</ApiContext.Provider>;
}
export function useApi() {
  const context = useContext(ApiContext);
  if (!context) throw new Error('ApiProvider отсутствует');
  return context;
}
export function useCourse() {
  const { api } = useApi();
  const { courseId = '' } = useParams();
  const [search] = useSearchParams();
  const version = search.get('version') ? Number(search.get('version')) : undefined;
  return useQuery({
    queryKey: [api.mode, 'course', courseId, version ?? 'latest'],
    queryFn: () => {
      if (version !== undefined && (!Number.isInteger(version) || version < 1))
        throw new ApiError(422, 'Неверный номер версии в адресе.');
      return api.get(courseId, version);
    },
    enabled: !!courseId,
    refetchInterval: (query) =>
      ['queued', 'running'].includes(query.state.data?.job.status || '') ? 2500 : false,
  });
}
export function useCourses() {
  const { api } = useApi();
  return useQuery({ queryKey: [api.mode, 'courses'], queryFn: () => api.list() });
}
export function useDeleteCourse() {
  const { api } = useApi();
  const query = useQueryClient();
  return useMutation({
    mutationFn: (courseId: string) => api.delete(courseId),
    onSuccess: async (_, courseId) => {
      query.removeQueries({ queryKey: [api.mode, 'course', courseId] });
      await query.invalidateQueries({ queryKey: [api.mode, 'courses'] });
    },
  });
}
export function useCommand() {
  const { api } = useApi();
  const query = useQueryClient();
  const { courseId } = useParams();
  return useMutation({
    mutationFn: async (
      input: CourseCommand & { expected_version?: number; course_id?: string },
    ) => {
      const command = { ...input, course_id: input.course_id || courseId };
      const signature = canonicalJson(command);
      const key = `courseos-pending-${api.mode}-${command.course_id || 'new'}-${command.action}`;
      const prior = localStorage.getItem(key);
      let requestId = crypto.randomUUID();
      if (prior) {
        const parsed: { signature: string; id: string } = JSON.parse(prior);
        if (parsed.signature === signature)
          requestId = parsed.id as `${string}-${string}-${string}-${string}-${string}`;
      }
      localStorage.setItem(key, JSON.stringify({ signature, id: requestId }));
      try {
        const result = await api.command({ ...command, request_id: requestId } as CommandEnvelope);
        localStorage.removeItem(key);
        return result;
      } catch (error) {
        if (error instanceof ApiError && [401, 403, 409, 413, 422].includes(error.status))
          localStorage.removeItem(key);
        throw error;
      }
    },
    onSuccess: async () => {
      await query.invalidateQueries({ queryKey: [api.mode] });
    },
  });
}
