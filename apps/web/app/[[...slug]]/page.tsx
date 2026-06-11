import { ClientApp } from './client-app';
import ProtectedRoute from '../../src/auth/ProtectedRoute';
import BlaiqShell from '../../src/auth/BlaiqShell';

export function generateStaticParams() {
  // List every top-level route the BlaiqShell renders so the static
  // export emits an HTML shell for each. Without this, deep-loading
  // /skills (or any non-root path) drops into Next's not-found UI
  // instead of the client SPA. Sub-routes (e.g. /projects/<id>) are
  // still client-routed from these shells once the SPA is hydrated.
  return [
    { slug: [] },
    { slug: ['brand'] },
    { slug: ['skills'] },
    { slug: ['memory'] },
    { slug: ['missions'] },
    { slug: ['workflows'] },
    { slug: ['swarm'] },
    { slug: ['agents'] },
    { slug: ['artifacts'] },
    { slug: ['admin'] },
    { slug: ['settings'] },
  ];
}

export default function Page() {
  return (
    <ProtectedRoute>
      <BlaiqShell>
        <ClientApp />
      </BlaiqShell>
    </ProtectedRoute>
  );
}
