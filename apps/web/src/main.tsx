import { StrictMode, Suspense, lazy, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from 'react-router-dom';
import './styles.css';
import { useSession } from './stores/session';
import { Toaster, TooltipProvider, Spinner } from './components/ui';
import { AppShell } from './app/AppShell';
import { Login, Signup, JoinWorkspace } from './pages/auth/Auth';

// Route-level code splitting keeps the dashboard's first load small; the editor is the heaviest chunk.
const Overview = lazy(() => import('./pages/Overview'));
const FormsList = lazy(() => import('./pages/forms/FormsList'));
const Editor = lazy(() => import('./pages/editor/Editor'));
const EventsList = lazy(() => import('./pages/events/EventsList'));
const EventDetail = lazy(() => import('./pages/events/EventDetail'));
const CheckIn = lazy(() => import('./pages/events/CheckIn'));
const CheckinRedirect = lazy(() => import('./pages/events/CheckinRedirect'));
const Responses = lazy(() => import('./pages/responses/Responses'));
const Guests = lazy(() => import('./pages/guests/Guests'));
const Templates = lazy(() => import('./pages/templates/Templates'));
const Analytics = lazy(() => import('./pages/analytics/Analytics'));
const Integrations = lazy(() => import('./pages/integrations/Integrations'));
const SettingsPage = lazy(() => import('./pages/settings/Settings'));
const Help = lazy(() => import('./pages/Help'));

const Loading = () => <div className="h-full min-h-[50vh] grid place-items-center"><Spinner className="size-5" /></div>;

function RequireAuth({ children }: { children: ReactNode }) {
  const status = useSession((s) => s.status);
  const location = useLocation();
  if (status === 'loading') return <Loading />;
  if (status === 'anonymous') return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <Suspense fallback={<Loading />}>{children}</Suspense>;
}

function RequireWorkspace({ children }: { children: ReactNode }) {
  const ws = useSession((s) => s.workspace);
  if (!ws) return <Loading />;
  return <>{children}</>;
}

const guard = (el: ReactNode) => <RequireAuth><RequireWorkspace>{el}</RequireWorkspace></RequireAuth>;
const page = (el: ReactNode) => <Suspense fallback={<Loading />}>{el}</Suspense>;

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/signup', element: <Signup /> },
  { path: '/join/:token', element: <JoinWorkspace /> },
  { path: '/forms/:formId/edit', element: guard(<Editor />) },
  { path: '/events/:eventId/checkin', element: guard(<CheckIn />) },
  { path: '/c/:token', element: guard(<CheckinRedirect />) },
  {
    path: '/',
    element: guard(<AppShell />),
    children: [
      { index: true, element: page(<Overview />) },
      { path: 'forms', element: page(<FormsList />) },
      { path: 'events', element: page(<EventsList />) },
      { path: 'events/:eventId', element: page(<EventDetail />) },
      { path: 'responses', element: page(<Responses />) },
      { path: 'responses/:submissionId', element: page(<Responses />) },
      { path: 'guests', element: page(<Guests />) },
      { path: 'templates', element: page(<Templates />) },
      { path: 'analytics', element: page(<Analytics />) },
      { path: 'integrations', element: page(<Integrations />) },
      { path: 'settings', element: page(<SettingsPage />) },
      { path: 'settings/:tab', element: page(<SettingsPage />) },
      { path: 'help', element: page(<Help />) },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

function App() {
  const load = useSession((s) => s.load);
  useEffect(() => { void load(); }, [load]);
  return (
    <TooltipProvider>
      <RouterProvider router={router} />
      <Toaster />
    </TooltipProvider>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
