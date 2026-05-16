// Port of HIVEMIND/BLAIQ AuthProvider.jsx to TS + Next.js routing.
// State machine is identical: loading/anonymous/authenticated/
// reauth_required/forbidden/backend_unreachable.

'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import apiClient, { type BootstrapData, HttpError } from '../shared/api-client';
import { installFetchPatch } from '../lib/install-fetch-patch';

if (typeof window !== 'undefined') installFetchPatch();

export type AuthState =
  | 'loading'
  | 'anonymous'
  | 'authenticated'
  | 'reauth_required'
  | 'forbidden'
  | 'backend_unreachable';

export interface AuthContextValue {
  isAuthenticated: boolean;
  loading: boolean;
  user: BootstrapData['user'] | null;
  org: BootstrapData['organization'] | null;
  roles: string[];
  permissions: string[];
  memberships: BootstrapData['workspace_memberships'];
  currentWorkspace: BootstrapData['workspace_memberships'][number] | null;
  setCurrentWorkspace: (
    ws: BootstrapData['workspace_memberships'][number] | null,
  ) => void;
  featureFlags: Record<string, boolean>;
  onboarding: BootstrapData['onboarding'];
  connectivity: BootstrapData['connectivity'];
  clientSupport: string[];
  login: () => void;
  logout: () => Promise<void>;
  authState: AuthState;
  refresh: () => Promise<void>;
  can: (permission: string) => boolean;
  apiClient: typeof apiClient;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const pathname = usePathname() ?? '/';
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [user, setUser] = useState<BootstrapData['user'] | null>(null);
  const [org, setOrg] = useState<BootstrapData['organization'] | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [memberships, setMemberships] = useState<BootstrapData['workspace_memberships']>([]);
  const [currentWorkspace, setCurrentWorkspace] = useState<
    BootstrapData['workspace_memberships'][number] | null
  >(null);
  const [featureFlags, setFeatureFlags] = useState<Record<string, boolean>>({});
  const [onboarding, setOnboarding] = useState<BootstrapData['onboarding']>(null);
  const [connectivity, setConnectivity] = useState<BootstrapData['connectivity']>(null);
  const [clientSupport, setClientSupport] = useState<string[]>([]);

  const bootstrap = useCallback(async (): Promise<void> => {
    setAuthState('loading');
    try {
      const data = await apiClient.bootstrap();
      setUser(data.user);
      setOrg(data.organization);
      setRoles(data.roles ?? []);
      setPermissions(data.permissions ?? []);
      setMemberships(data.workspace_memberships ?? []);
      const ws = data.workspace_memberships?.[0] ?? null;
      if (ws) setCurrentWorkspace(ws);
      setFeatureFlags(data.feature_flags ?? {});
      setOnboarding(data.onboarding ?? null);
      setConnectivity(data.connectivity ?? null);
      setClientSupport(Array.isArray(data.client_support) ? data.client_support : []);
      setAuthState('authenticated');
    } catch (err) {
      const status = err instanceof HttpError ? err.response.status : undefined;
      if (status === 401) {
        setAuthState('anonymous');
      } else if (status === 403) {
        setAuthState('forbidden');
      } else if (status === 502 || status === 503) {
        setAuthState('backend_unreachable');
      } else if (status === undefined) {
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.warn('[AuthProvider] backend unreachable in dev — using fallback');
          const devWs = { id: 'dev-ws', name: 'Dev Workspace', slug: 'dev', role: 'admin' };
          setUser({ id: 'dev-user', email: 'dev@blaiq.ai', display_name: 'Dev User', role: 'admin' });
          setOrg({ id: 'dev-org', name: 'Dev Org', slug: 'dev' });
          setRoles(['admin']);
          setPermissions(['*']);
          setMemberships([devWs]);
          setCurrentWorkspace(devWs);
          setFeatureFlags({});
          setOnboarding({ completed: true, step: 'dev' });
          setConnectivity({ core_api_base_url: '', core_health: 'unknown' });
          setClientSupport(['claude', 'codex', 'web']);
          setAuthState('authenticated');
          return;
        }
        setAuthState('backend_unreachable');
      } else {
        setAuthState('anonymous');
      }
      setUser(null);
      setOrg(null);
      setRoles([]);
      setPermissions([]);
      setMemberships([]);
      setFeatureFlags({});
      setOnboarding(null);
      setConnectivity(null);
      setClientSupport([]);
    }
  }, []);

  const isPublicRoute = useCallback((): boolean => {
    return pathname === '/' || pathname === '/login' || pathname === '/signup';
  }, [pathname]);

  useEffect(() => {
    if (isPublicRoute()) {
      setAuthState('anonymous');
      return;
    }
    void bootstrap();
  }, [bootstrap, isPublicRoute, pathname]);

  const login = useCallback((): void => {
    if (typeof window !== 'undefined') {
      window.location.href = apiClient.getLoginUrl(window.location.pathname);
    }
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await apiClient.logout();
    } finally {
      setUser(null);
      setAuthState('anonymous');
      if (typeof window !== 'undefined') window.location.reload();
    }
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      await apiClient.refresh();
      await bootstrap();
    } catch {
      setAuthState('reauth_required');
    }
  }, [bootstrap]);

  const can = useCallback(
    (permission: string): boolean => {
      if (permissions.includes('*')) return true;
      return permissions.includes(permission);
    },
    [permissions],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: authState === 'authenticated',
      loading: authState === 'loading',
      user,
      org,
      roles,
      permissions,
      memberships,
      currentWorkspace,
      setCurrentWorkspace,
      featureFlags,
      onboarding,
      connectivity,
      clientSupport,
      login,
      logout,
      authState,
      refresh,
      can,
      apiClient,
    }),
    [
      authState,
      user,
      org,
      roles,
      permissions,
      memberships,
      currentWorkspace,
      featureFlags,
      onboarding,
      connectivity,
      clientSupport,
      login,
      logout,
      refresh,
      can,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
