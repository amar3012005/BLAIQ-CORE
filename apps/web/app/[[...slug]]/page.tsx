import { ClientApp } from './client-app';
import ProtectedRoute from '../../src/auth/ProtectedRoute';
import BlaiqShell from '../../src/auth/BlaiqShell';

export function generateStaticParams() {
  return [{ slug: [] }];
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
