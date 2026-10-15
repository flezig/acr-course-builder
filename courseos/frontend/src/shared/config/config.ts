import { z } from 'zod';
const configSchema = z.object({ mode: z.enum(['demo', 'live']), apiUrl: z.string().min(1) });
export const config = configSchema.parse({
  mode: import.meta.env.VITE_COURSE_MODE || 'demo',
  apiUrl: import.meta.env.VITE_COURSE_API_URL || '/api/v1',
});
