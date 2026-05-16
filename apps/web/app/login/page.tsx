import { Suspense } from 'react';
import LoginPage from '../../src/auth/LoginPage';

export default function Page(): JSX.Element {
  return (
    <Suspense fallback={null}>
      <LoginPage />
    </Suspense>
  );
}
