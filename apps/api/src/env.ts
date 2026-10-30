export interface Env {
  DB: D1Database;
  UPLOADS: R2Bucket;
  NOTIFICATIONS: Queue<QueueMessage>;
  ASSETS: Fetcher;
  APP_NAME: string;
  APP_URL: string;
  EMAIL_FROM: string;
  EMAIL_MODE: 'log' | 'resend';
  TRIAL_PLAN: string;
  TRIAL_DAYS: string;
  RESEND_API_KEY?: string;
  IP_HASH_SALT?: string;
  SENTRY_DSN?: string;
  RATE_LIMIT_SCALE?: string;
}

export interface QueueMessage {
  jobId: string;
}

export type Role = 'owner' | 'admin' | 'editor' | 'viewer';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface WorkspaceContext {
  id: string;
  role: Role;
}

export type AppBindings = {
  Bindings: Env;
  Variables: {
    user: AuthUser | null;
    sessionId: string | null;
    workspace: WorkspaceContext;
    requestId: string;
  };
};
