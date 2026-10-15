import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider, Link } from 'react-router-dom';
import { ApiProvider } from './app/providers/api-provider';
import { Layout } from './app/layout';
import { CreateCoursePage } from './pages/create-course/page';
import { PlanPage } from './pages/course-plan/page';
import { MapPage } from './pages/competencies/page';
import { MaterialsPage } from './pages/materials/page';
import { AuditPage } from './pages/audit/page';
import { ComparisonPage } from './pages/comparison/page';
import './app/styles/global.css';
import './app/styles/workspace.css';
import './app/styles/results-map.css';
const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <CreateCoursePage /> },
      { path: '/create', element: <CreateCoursePage /> },
      { path: '/courses/:courseId/plan', element: <PlanPage /> },
      { path: '/courses/:courseId/map', element: <MapPage /> },
      { path: '/courses/:courseId/materials', element: <MaterialsPage /> },
      { path: '/courses/:courseId/audit', element: <AuditPage /> },
      { path: '/courses/:courseId/compare', element: <ComparisonPage /> },
      {
        path: '*',
        element: (
          <div className="empty">
            <h1>Страница не найдена</h1>
            <Link to="/">Создать или открыть курс</Link>
          </div>
        ),
      },
    ],
  },
]);
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ApiProvider>
      <RouterProvider router={router} />
    </ApiProvider>
  </React.StrictMode>,
);
