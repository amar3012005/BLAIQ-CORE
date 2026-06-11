import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { APIListResponse, AgentActivity } from '@/types';

export type { AgentActivity };

export function useAgentActivities(agentId?: string, limit = 50) {
  return useQuery({
    queryKey: ['activities', agentId, limit],
    queryFn: () =>
      apiFetch<APIListResponse<AgentActivity>>(
        `/api/agents/${agentId}/activities?limit=${limit}`,
      ),
    enabled: !!agentId,
    refetchInterval: 5000,
  });
}

export function useTeamActivities(teamId: string) {
  return useQuery({
    queryKey: ['team-activities', teamId],
    queryFn: () =>
      apiFetch<{ data: AgentActivity[] }>(
        `/api/teams/${teamId}/activities?limit=100`,
      ),
    enabled: !!teamId,
    refetchInterval: 10000,
  });
}
