// Express handlers for the /api/v1/auth/* endpoints consumed by the
// frontend AuthProvider (HIVEMIND-style bootstrap).

import type { Request, Response, Router } from 'express';
import {
  bootstrapForSession,
  createUser,
  login,
  logout,
  refresh,
  resolveSession,
} from './sessions.js';

export function registerAuthRoutes(router: Router): void {
  router.post('/api/v1/auth/login', async (req: Request, res: Response) => {
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
    const result = await login(req, res, email ?? '', password ?? '');
    if ('error' in result) {
      res.status(result.status).json({ detail: result.error });
      return;
    }
    res.status(200).json(result.bootstrap);
  });

  router.post('/api/v1/auth/signup', async (req: Request, res: Response) => {
    if (process.env.OD_SIGNUP_ENABLED !== '1') {
      res.status(403).json({ detail: 'signup disabled' });
      return;
    }
    const { email, password, display_name, tenant_name } = (req.body ?? {}) as {
      email?: string;
      password?: string;
      display_name?: string;
      tenant_name?: string;
    };
    try {
      await createUser({
        email: email ?? '',
        password: password ?? '',
        ...(display_name ? { displayName: display_name } : {}),
        ...(tenant_name ? { tenantName: tenant_name } : {}),
      });
      // Auto-login after signup.
      const result = await login(req, res, email ?? '', password ?? '');
      if ('error' in result) {
        res.status(result.status).json({ detail: result.error });
        return;
      }
      res.status(201).json(result.bootstrap);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('duplicate key')) {
        res.status(409).json({ detail: 'email already registered' });
        return;
      }
      res.status(400).json({ detail: msg });
    }
  });

  router.get('/api/v1/auth/bootstrap', async (req: Request, res: Response) => {
    const session = await resolveSession(req);
    if (!session) {
      res.status(401).json({ detail: 'not authenticated' });
      return;
    }
    const body = await bootstrapForSession(session);
    res.status(200).json(body);
  });

  router.post('/api/v1/auth/refresh', async (req: Request, res: Response) => {
    const result = await refresh(req, res);
    if ('error' in result) {
      res.status(result.status).json({ detail: result.error });
      return;
    }
    res.status(200).json(result.bootstrap);
  });

  router.post('/api/v1/auth/logout', async (req: Request, res: Response) => {
    await logout(req, res);
    res.status(204).end();
  });
}
