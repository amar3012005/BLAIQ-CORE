// ProjectsBoard — legacy file kept as re-export shim.
// ErrorBanner and SkeletonList are the canonical exports; they live here so
// existing imports don't break while TasksWall and other consumers migrate.

'use client';

export { ErrorBanner, SkeletonList } from './JobBoard';
