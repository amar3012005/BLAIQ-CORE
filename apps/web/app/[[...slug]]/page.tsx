import { ClientApp } from './client-app';
import ProtectedRoute from '../../src/auth/ProtectedRoute';

// The whole product is a client-driven SPA: project IDs and file paths are
// unbounded user input, so we route every URL through this single optional
// catch-all and let the existing client router (src/router.ts, which reads
// window.location at runtime) decide what to render.
export function generateStaticParams() {
  return [{ slug: [] }];
}

export default function Page() {
  return (
    <ProtectedRoute>
      <ClientApp />
    </ProtectedRoute>
  );
}
