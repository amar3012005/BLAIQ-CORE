// Standalone, auth-free preview of the BLAIQ Admin surface.
//
// The real /admin route lives behind ProtectedRoute + the daemon proxy. This
// route mounts the SAME admin components against an in-memory demo store
// (see enablePreviewMode in src/auth/admin/api.ts) so the UI — and every
// Phase 1 workflow action — can be exercised locally with zero backend.
//
// It is intentionally excluded from generateStaticParams; it is a dev/demo
// aid, reached directly at /admin-preview.

'use client';

import React from 'react';
import { enablePreviewMode } from '../../src/auth/admin/api';
import AdminPage from '../../src/auth/AdminPage';

// Flip the api layer into in-memory mode before any component effect runs.
enablePreviewMode();

export default function AdminPreviewPage(): JSX.Element {
  return <AdminPage />;
}
