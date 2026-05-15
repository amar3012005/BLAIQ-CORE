// Port of HIVEMIND/BLAIQ ProtectedRoute.jsx to Next.js client routing.

'use client';

import React, { useEffect, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from './AuthProvider.js';

export default function ProtectedRoute({ children }: { children: ReactNode }): JSX.Element | null {
  const { isAuthenticated, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? '/';

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      const next = encodeURIComponent(pathname);
      router.replace(`/login?next=${next}`);
    }
  }, [loading, isAuthenticated, pathname, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-[#bdf213] border-t-transparent rounded-full animate-spin" />
          <span className="text-white/50 text-sm font-['Space_Grotesk']">Loading BLAIQ...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return null;
  return <>{children}</>;
}
