import { create } from 'zustand';
import { ApiError, get, post } from '../lib/api';

export interface User { id: string; email: string; name: string }
export interface WorkspaceSummary { id: string; name: string; slug: string; role: 'owner' | 'admin' | 'editor' | 'viewer' }
export interface WorkspaceDetail {
  id: string; name: string; slug: string; role: WorkspaceSummary['role']; branding: { logoUrl?: string; hideBranding?: boolean };
  entitlements: { planId: string; planName: string; status: string; trialEndsAt: string | null; limits: Record<string, number>; features: Record<string, boolean> };
  usage: Record<string, number>;
}

interface SessionState {
  status: 'loading' | 'authenticated' | 'anonymous';
  user: User | null;
  workspaces: WorkspaceSummary[];
  workspaceId: string | null;
  workspace: WorkspaceDetail | null;
  load: () => Promise<void>;
  selectWorkspace: (id: string) => Promise<void>;
  refreshWorkspace: () => Promise<void>;
  logout: () => Promise<void>;
}

const WS_KEY = 'invitely.workspace';

export const useSession = create<SessionState>((set, getState) => ({
  status: 'loading',
  user: null,
  workspaces: [],
  workspaceId: null,
  workspace: null,
  async load() {
    try {
      const me = await get<{ user: User | null; workspaces: WorkspaceSummary[] }>('/auth/session');
      if (!me.user) { set({ status: 'anonymous', user: null, workspaces: [], workspace: null, workspaceId: null }); return; }
      const saved = localStorage.getItem(WS_KEY);
      const wid = me.workspaces.find((w) => w.id === saved)?.id ?? me.workspaces[0]?.id ?? null;
      set({ user: me.user, workspaces: me.workspaces, workspaceId: wid, status: 'authenticated' });
      if (wid) await getState().refreshWorkspace();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) set({ status: 'anonymous', user: null, workspaces: [], workspace: null, workspaceId: null });
      else set({ status: 'anonymous' });
    }
  },
  async selectWorkspace(id) {
    localStorage.setItem(WS_KEY, id);
    set({ workspaceId: id, workspace: null });
    await getState().refreshWorkspace();
  },
  async refreshWorkspace() {
    const id = getState().workspaceId;
    if (!id) return;
    const ws = await get<WorkspaceDetail>(`/w/${id}`);
    set({ workspace: ws });
  },
  async logout() {
    await post('/auth/logout').catch(() => undefined);
    set({ status: 'anonymous', user: null, workspaces: [], workspace: null, workspaceId: null });
  },
}));

/** Workspace-scoped API path helper, e.g. wpath('/forms') → /w/ws_123/forms */
export function wpath(path: string): string {
  const id = useSession.getState().workspaceId;
  if (!id) throw new Error('No workspace selected');
  return `/w/${id}${path}`;
}

export function useWpath() {
  const id = useSession((s) => s.workspaceId);
  return (path: string) => (id ? `/w/${id}${path}` : null);
}

export function useCan() {
  const role = useSession((s) => s.workspace?.role ?? 'viewer');
  return {
    write: role !== 'viewer',
    manage: role === 'owner' || role === 'admin',
    billing: role === 'owner',
    role,
  };
}
