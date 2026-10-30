import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams, Navigate } from 'react-router-dom';
import { ApiError, post } from '../../lib/api';
import { useSession } from '../../stores/session';
import { Button, Field, Input } from '../../components/ui';
import { toast } from '../../stores/toast';

function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: ReactNode; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="min-h-full grid lg:grid-cols-[1fr_1.05fr]">
      <div className="flex flex-col px-6 sm:px-12 py-10">
        <Link to="/" className="flex items-center gap-2 font-semibold text-[15px]"><img src="/favicon.svg" alt="" className="size-7" />Invitely</Link>
        <div className="flex-1 flex items-center">
          <div className="w-full max-w-[380px] mx-auto py-12">
            <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{title}</h1>
            <p className="text-muted mt-1.5 text-[14px]">{subtitle}</p>
            <div className="mt-8">{children}</div>
            <p className="text-[13px] text-muted mt-6">{footer}</p>
          </div>
        </div>
      </div>
      <div className="hidden lg:flex relative overflow-hidden bg-[#F1EFE9] border-l border-line items-center justify-center p-12">
        <div className="w-full max-w-[440px] space-y-3">
          <div className="card shadow-md p-6 rotate-[-1.2deg]">
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted">You’re invited</p>
            <p className="font-[Georgia,serif] text-[26px] mt-2 leading-tight">Sarah &amp; John</p>
            <p className="text-[13px] text-muted mt-1">Saturday, 12 December · Udaipur</p>
            <div className="grid grid-cols-2 gap-2 mt-5">
              <div className="h-11 rounded-lg border-2 border-brand-500 bg-brand-50 grid place-items-center text-[13px] font-medium text-brand-700">Joyfully accept</div>
              <div className="h-11 rounded-lg border border-line-strong grid place-items-center text-[13px] text-ink-2">Regretfully decline</div>
            </div>
          </div>
          <div className="card shadow-md p-5 ml-10 rotate-[1deg]">
            <div className="flex justify-between text-[12.5px]"><span className="text-muted">Responses</span><span className="text-success font-medium">+12 today</span></div>
            <div className="flex items-end gap-6 mt-2">
              <div><p className="text-[24px] font-semibold tabular">148</p><p className="text-[12px] text-muted">accepted</p></div>
              <div><p className="text-[24px] font-semibold tabular">23</p><p className="text-[12px] text-muted">declined</p></div>
              <div><p className="text-[24px] font-semibold tabular">212</p><p className="text-[12px] text-muted">expected guests</p></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Login() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const status = useSession((s) => s.status);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (status === 'authenticated') return <Navigate to={safeNext(params.get('next'))} replace />;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await post('/auth/login', { email, password });
      await useSession.getState().load();
      navigate(safeNext(params.get('next')), { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in');
    } finally { setBusy(false); }
  };
  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to manage your forms and events." footer={<>New here? <Link className="text-brand-600 font-medium" to={`/signup${params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : ''}`}>Create an account</Link></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email" htmlFor="email"><Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
        <Field label="Password" htmlFor="password"><Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        {error && <p className="text-[13px] text-danger" role="alert">{error}</p>}
        <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={busy}>Sign in</Button>
      </form>
    </AuthLayout>
  );
}

export function Signup() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const status = useSession((s) => s.status);
  const [form, setForm] = useState({ name: '', email: '', password: '', workspaceName: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  if (status === 'authenticated') return <Navigate to={safeNext(params.get('next'))} replace />;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErrors({});
    try {
      await post('/auth/signup', { ...form, workspaceName: form.workspaceName || undefined });
      await useSession.getState().load();
      toast.success('Welcome to Invitely!', 'Your 14-day Pro trial has started.');
      navigate(safeNext(params.get('next')), { replace: true });
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details)) setErrors(Object.fromEntries(err.details.map((d: { path: string; message: string }) => [d.path, d.message])));
      else setErrors({ form: err instanceof Error ? err.message : 'Could not sign up' });
    } finally { setBusy(false); }
  };
  return (
    <AuthLayout title="Create your account" subtitle="Beautiful forms, RSVPs and guest lists — free to start." footer={<>Already have an account? <Link className="text-brand-600 font-medium" to="/login">Sign in</Link></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Your name" htmlFor="name" error={errors.name}><Input id="name" autoComplete="name" value={form.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Email" htmlFor="email" error={errors.email}><Input id="email" type="email" autoComplete="email" value={form.email} onChange={set('email')} /></Field>
        <Field label="Password" htmlFor="password" error={errors.password} hint="At least 8 characters"><Input id="password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} /></Field>
        <Field label={<>Workspace name <span className="text-faint font-normal">(optional)</span></>} htmlFor="ws" hint="For example your company, agency or “Our Wedding”."><Input id="ws" value={form.workspaceName} onChange={set('workspaceName')} /></Field>
        {errors.form && <p className="text-[13px] text-danger" role="alert">{errors.form}</p>}
        <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={busy}>Create account</Button>
      </form>
    </AuthLayout>
  );
}

export function JoinWorkspace() {
  const { token } = useParams();
  const status = useSession((s) => s.status);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  if (status === 'loading') return null;
  if (status === 'anonymous') return <Navigate to={`/login?next=${encodeURIComponent(`/join/${token}`)}`} replace />;
  return (
    <AuthLayout title="Join workspace" subtitle="You’ve been invited to collaborate." footer={<Link to="/">Back to dashboard</Link>}>
      <Button variant="primary" size="lg" className="w-full justify-center" loading={busy} onClick={async () => {
        setBusy(true);
        try { const r = await post<{ workspaceId: string }>(`/auth/workspace-invitations/${token}/accept`); await useSession.getState().load(); await useSession.getState().selectWorkspace(r.workspaceId); navigate('/'); toast.success('You joined the workspace'); }
        catch (e) { toast.error(e); } finally { setBusy(false); }
      }}>Accept invitation</Button>
    </AuthLayout>
  );
}
