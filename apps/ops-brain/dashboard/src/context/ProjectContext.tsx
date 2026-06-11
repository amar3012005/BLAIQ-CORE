import { createContext, useContext, useState, useCallback } from 'react';
import { setCurrentProjectPath, setCurrentProjectId } from '@/api/client';

const STORAGE_KEY = 'ai-team-os:project';

interface ProjectState {
  projectId: string | null;
  projectPath: string | null;
  projectName: string | null;
}

interface ProjectContextValue extends ProjectState {
  switchProject: (id: string, path: string, name: string) => void;
  clearProject: () => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

function loadFromStorage(): ProjectState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore parse errors
  }
  return { projectId: null, projectPath: null, projectName: null };
}

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  // Sync the api/client module-level state on initial load. We do this
  // synchronously (not in useEffect) so that the very first apiFetch call
  // — even if it fires during the same React commit as a project switch —
  // already sees the correct X-Project-Id header.
  const [state, setState] = useState<ProjectState>(() => {
    const initial = loadFromStorage();
    setCurrentProjectPath(initial.projectPath);
    setCurrentProjectId(initial.projectId);
    return initial;
  });

  const switchProject = useCallback((id: string, path: string, name: string) => {
    // CRITICAL: write the module-level header state BEFORE setState so any
    // queries triggered by the same render (e.g. invalidateQueries called
    // immediately after switchProject) read the new project id, not the old one.
    // The previous useEffect-based sync ran one tick late, causing race
    // conditions where invalidated queries refetched with the OLD header.
    setCurrentProjectPath(path);
    setCurrentProjectId(id);
    const next: ProjectState = { projectId: id, projectPath: path, projectName: name };
    setState(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const clearProject = useCallback(() => {
    setCurrentProjectPath(null);
    setCurrentProjectId(null);
    setState({ projectId: null, projectPath: null, projectName: null });
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return (
    <ProjectContext.Provider value={{ ...state, switchProject, clearProject }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject must be used within ProjectProvider');
  return ctx;
}
