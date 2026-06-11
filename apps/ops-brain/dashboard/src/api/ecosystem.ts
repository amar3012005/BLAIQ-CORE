import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

// 与后端 /api/ecosystem/profiles 返回格式对齐
export interface EcosystemRepoProfile {
  id: string;
  repo_full_name: string;
  name: string;
  owner: string;
  description: string | null;
  stars: number;
  language: string | null;
  topics: string[];
  homepage: string | null;
  last_commit_at: string | null;
  needs_deep_review: boolean;
  relevance_category: string | null;
  relevance_score: number;
  one_line_summary: string | null;
  last_scanned_at: string;
  first_seen_at: string;
  // Stage B 扩展字段（v2 API 返回时填充）
  pushed_at?: string | null;
  is_archived?: boolean;
  scan_run_id?: string | null;
  description_excerpt?: string;
  // v1.5.0-A 扩展字段（前端 stage 徽章 / failed 提示 / 活跃集 tab 依赖）
  shallow_summary?: string;
  last_shallow_refreshed_at?: string | null;
  is_deleted?: boolean;
  is_private_now?: boolean;
  last_fetch_error?: string;
  fetch_failure_count?: number;
  is_active?: boolean;
  active_rank?: number | null;
}

// v1.5.0 漏斗 stage 状态
export const ECOSYSTEM_STAGE_STATUSES = [
  'queued',
  'shallow_done',
  'shallow_failed',
  'architecture_done',
  'architecture_failed',
  'debated',
  'debated_failed',
  'referenced',
  'integrated',
] as const;

export type EcosystemStageStatus = (typeof ECOSYSTEM_STAGE_STATUSES)[number];

/** stage 中文标签 */
export const STAGE_STATUS_LABELS: Record<EcosystemStageStatus, string> = {
  queued: '待浅扫',
  shallow_done: '浅扫完成',
  shallow_failed: '浅扫失败',
  architecture_done: '架构已分析',
  architecture_failed: '架构失败',
  debated: '已辩论',
  debated_failed: '辩论失败',
  referenced: '✓ 参考',
  integrated: '★ 已集成',
};

/** stage 颜色（与设计稿 §8.1 对齐：灰/蓝/黄/橙/绿/紫/红） */
export const STAGE_STATUS_TONE: Record<
  EcosystemStageStatus,
  'gray' | 'blue' | 'yellow' | 'orange' | 'green' | 'purple' | 'red'
> = {
  queued: 'gray',
  shallow_done: 'blue',
  shallow_failed: 'red',
  architecture_done: 'yellow',
  architecture_failed: 'red',
  debated: 'orange',
  debated_failed: 'red',
  referenced: 'green',
  integrated: 'purple',
};

/** stage 徽章 className（Tailwind 同构色） */
export function stageBadgeClass(stage: EcosystemStageStatus | string): string {
  const tone = STAGE_STATUS_TONE[stage as EcosystemStageStatus] ?? 'gray';
  switch (tone) {
    case 'gray':
      return 'bg-muted text-muted-foreground border-border';
    case 'blue':
      return 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30';
    case 'yellow':
      return 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30';
    case 'orange':
      return 'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30';
    case 'green':
      return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30';
    case 'purple':
      return 'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30';
    case 'red':
      return 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

export interface EcosystemFacetCounts {
  category: Record<string, number>;
  language: Record<string, number>;
  archived: Record<string, number>; // {"true": n, "false": n}
}

export interface EcosystemProfilesResponse {
  profiles: EcosystemRepoProfile[];
  total: number;
  limit?: number;
  offset?: number;
  facet_counts?: EcosystemFacetCounts;
}

export interface EcosystemFilters {
  keyword?: string;
  topic?: string;
  category?: string;
  minStars?: number;
  maxStars?: number;
  needsDeepReview?: boolean | null;
  limit?: number;
  facetCounts?: boolean;
  // v1.5.0-E 新增：活跃/全量/已删除 tab + stage 维度筛选
  isActive?: boolean | null;
  isDeleted?: boolean | null;
  stageStatus?: string; // 多个用逗号分隔
}

/**
 * 列表查询：检索生态仓档案。
 * 对接 GET /api/ecosystem/profiles
 */
export function useEcosystemProfiles(filters: EcosystemFilters = {}) {
  const {
    keyword = '',
    topic = '',
    category = '',
    minStars = 0,
    maxStars = 0,
    needsDeepReview = null,
    limit = 200,
    facetCounts = false,
    isActive = null,
    isDeleted = null,
    stageStatus = '',
  } = filters;

  const params = new URLSearchParams();
  if (keyword) params.set('keyword', keyword);
  if (topic) params.set('topic', topic);
  if (category) params.set('category', category);
  if (minStars > 0) params.set('min_stars', String(minStars));
  if (maxStars > 0) params.set('max_stars', String(maxStars));
  if (needsDeepReview !== null) params.set('needs_deep_review', String(needsDeepReview));
  params.set('limit', String(limit));
  if (facetCounts) params.set('facet_counts', 'true');
  if (isActive !== null) params.set('is_active', String(isActive));
  if (isDeleted !== null) params.set('is_deleted', String(isDeleted));
  if (stageStatus) params.set('stage_status', stageStatus);

  return useQuery({
    queryKey: ['ecosystem', 'profiles', filters],
    queryFn: () => apiFetch<EcosystemProfilesResponse>(`/api/ecosystem/profiles?${params.toString()}`),
  });
}

/**
 * 单仓档案 hook（基础信息）— 用于不需要深度档案的场景。
 * 通过 /profiles 列表回退查找（保持向后兼容）。
 */
export function useEcosystemRepoDetail(repoId: string | null) {
  return useQuery({
    queryKey: ['ecosystem', 'repo', repoId],
    queryFn: async (): Promise<EcosystemRepoProfile | null> => {
      if (!repoId) return null;
      const data = await apiFetch<EcosystemProfilesResponse>(`/api/ecosystem/profiles?limit=200`);
      return data.profiles.find((p) => p.id === repoId) ?? null;
    },
    enabled: !!repoId,
  });
}

// ============================================================
// v2 API: 单仓全息详情 (BUG-023 修复)
// ============================================================

/** 能力 / 成熟度 / 风险 标签 */
export interface EcosystemTag {
  tag_id: string;
  name: string;
  category: string; // capability / maturity / risk / ...
  aliases: string[];
  description: string | null;
  confidence: number; // 0-1
  source: string; // github_topic / auto_rule / llm / manual
  agent_id: string | null;
  created_at: string;
}

/** 深扫记录 */
export interface EcosystemDeepReview {
  id: string;
  repo_id: string;
  status: string; // pending / running / completed / failed
  agent_id: string | null;
  summary_md: string;
  architecture_md: string;
  demo_result: string | null;
  demo_log_excerpt: string | null;
  risks_md: string;
  learnings_md: string;
  integration_recommendation: string | null; // adopt / experiment / hold / avoid
  report_id: string | null;
  created_at: string;
  // v1.5.0-A 字段（前端 timeline 依赖）
  stage_status?: EcosystemStageStatus | string;
  integration_md?: string;
  shallow_completed_at?: string | null;
  architecture_completed_at?: string | null;
  debated_at?: string | null;
  stage3_completed_at?: string | null;
  debate_meeting_id?: string | null;
  integration_task_id?: string | null;
}

/** 仓与仓的关联关系 */
export interface EcosystemRelation {
  id: string;
  source_repo_id: string;
  target_repo_id: string;
  source_repo_full_name?: string;
  target_repo_full_name?: string;
  relation_type: string; // depends_on / inspired_by / fork_of / replaces / ...
  confidence: number;
  evidence: string | null;
  created_at: string;
}

/** 扫描运行记录 */
export interface EcosystemScanRun {
  id: string;
  agent_id: string | null;
  scan_type: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  repos_added: number;
  repos_updated: number;
  notes: string | null;
}

/** v2 全息响应 — 与后端 EcosystemRepoFullResponse 对齐 */
export interface EcosystemRepoFullResponse {
  profile: EcosystemRepoProfile;
  tags: EcosystemTag[];
  deep_reviews: EcosystemDeepReview[];
  relations_from: EcosystemRelation[];
  relations_to: EcosystemRelation[];
  scan_run: EcosystemScanRun | null;
}

/** 深扫列表响应 — 用于统计真实 completed/running/failed 数 */
export interface EcosystemDeepReviewListResponse {
  reviews: EcosystemDeepReview[];
  total: number;
}

/**
 * 列出深扫记录，可按 status 过滤（completed / running / pending / failed / skipped）。
 * 用于 StatsBar 计算真实"已深扫"数量（语义 = DeepReview.status='completed' 的行数）。
 *
 * 注意：profile.needs_deep_review 字段语义是"是否需要被深扫"，false 不等于"已完成深扫"。
 * 必须用本接口拉真实 DeepReview 行为准。
 */
export function useEcosystemDeepReviews(status: string = '') {
  return useQuery({
    queryKey: ['ecosystem', 'deep_reviews', status],
    queryFn: () => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      params.set('limit', '100'); // 后端上限 100；当前数据量 < 100 充足
      return apiFetch<EcosystemDeepReviewListResponse>(
        `/api/ecosystem/deep_reviews?${params.toString()}`,
      );
    },
    staleTime: 30_000,
  });
}

/**
 * v2: GET /api/ecosystem/profiles/{repo_full_name:path}/full — 全息详情
 *
 * 接受 UUID 或 repo_full_name。若传 UUID，会先在缓存的列表里查找对应 full_name。
 * 失败时返回 null（不抛错），上层降级展示基础信息。
 */
export function useEcosystemRepoFull(repoIdOrName: string | null) {
  return useQuery({
    queryKey: ['ecosystem', 'repo-full', repoIdOrName],
    queryFn: async (): Promise<EcosystemRepoFullResponse | null> => {
      if (!repoIdOrName) return null;

      // 判定是 UUID 还是 owner/name
      let repoFullName = repoIdOrName;
      const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        repoIdOrName,
      );
      if (looksLikeUuid) {
        // 后端 limit 上限 200，分页拉取所有页直到命中
        const pageSize = 200;
        let offset = 0;
        let hit: EcosystemRepoProfile | undefined;
        // 防御性兜底：最多 10 页（2000 仓），避免循环
        for (let page = 0; page < 10; page++) {
          const list = await apiFetch<EcosystemProfilesResponse & { offset?: number }>(
            `/api/ecosystem/profiles?limit=${pageSize}&offset=${offset}`,
          );
          hit = list.profiles.find((p) => p.id === repoIdOrName);
          if (hit) break;
          if (list.profiles.length < pageSize) break; // 末页
          offset += pageSize;
        }
        if (!hit) return null;
        repoFullName = hit.repo_full_name;
      }

      // path 参数包含斜杠：单段 encode 即可（path-converter 接受 /）
      const encoded = repoFullName
        .split('/')
        .map((seg) => encodeURIComponent(seg))
        .join('/');
      try {
        return await apiFetch<EcosystemRepoFullResponse>(
          `/api/ecosystem/profiles/${encoded}/full`,
        );
      } catch {
        return null;
      }
    },
    enabled: !!repoIdOrName,
    retry: false,
  });
}

/** 深扫状态中文映射 */
export const DEEP_REVIEW_STATUS_LABELS: Record<string, string> = {
  pending: '待深扫',
  running: '深扫中',
  completed: '已完成',
  failed: '失败',
  skipped: '已跳过',
};

/** 集成建议中文映射 */
export const INTEGRATION_RECOMMENDATION_LABELS: Record<string, string> = {
  adopt: '采纳',
  experiment: '试验',
  hold: '观望',
  avoid: '回避',
};

/** 关联关系类型中文映射 */
export const RELATION_TYPE_LABELS: Record<string, string> = {
  depends_on: '依赖',
  inspired_by: '受启发',
  fork_of: 'Fork 自',
  replaces: '替代',
  similar_to: '相似',
  extends: '扩展',
  uses: '使用',
};

/**
 * 类别选项 — 与后端 EcosystemRepoProfile.relevance_category 对齐。
 */
export const RELEVANCE_CATEGORIES = [
  'agent-framework',
  'mcp-server',
  'memory-system',
  'skill-system',
  'tooling',
] as const;

export type RelevanceCategory = (typeof RELEVANCE_CATEGORIES)[number];

/**
 * 类别中文显示名（保持与后端字段值一致）。
 */
export const CATEGORY_LABELS: Record<string, string> = {
  'agent-framework': 'Agent 框架',
  'mcp-server': 'MCP 服务器',
  'memory-system': '记忆系统',
  'skill-system': '技能系统',
  tooling: '开发工具',
};

// ============================================================
// v1.5.0-E: Project Settings (决策 12.1)
// ============================================================

/** 项目级 ecosystem 配置 — 与后端 EcosystemProjectSettings 对齐 */
export interface EcosystemProjectSettings {
  project_id: string;
  min_stars: number;
  top_n: number;
  refresh_interval_days: number;
  auto_shallow_on_archive: boolean;
  focus_topics: string[];
  focus_languages: string[];
  shallow_concurrency: number;
  deep_concurrency: number;
  created_at: string | null;
  updated_at: string | null;
}

/** 用 PUT 提交时的入参（不带 timestamps） */
export type EcosystemProjectSettingsInput = Omit<
  EcosystemProjectSettings,
  'project_id' | 'created_at' | 'updated_at'
>;

/** GET /api/ecosystem/projects/{project_id}/settings */
export function useEcosystemProjectSettings(projectId: string | null) {
  return useQuery({
    queryKey: ['ecosystem', 'project-settings', projectId],
    queryFn: () =>
      apiFetch<EcosystemProjectSettings>(
        `/api/ecosystem/projects/${projectId}/settings`,
      ),
    enabled: !!projectId,
  });
}

/** PUT /api/ecosystem/projects/{project_id}/settings */
export function useUpdateProjectSettings(projectId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: EcosystemProjectSettingsInput) => {
      if (!projectId) throw new Error('projectId required');
      return await apiFetch<EcosystemProjectSettings>(
        `/api/ecosystem/projects/${projectId}/settings`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ecosystem', 'project-settings', projectId] });
    },
  });
}

// ============================================================
// v1.5.0-E: Failed repo retry
// ============================================================

/** POST /api/ecosystem/profiles/{repo_id}/retry — 立即重试失败的仓 */
export function useRetryFailedRepo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (repoId: string) =>
      apiFetch<{ success: boolean; repo_full_name: string; next_action: string }>(
        `/api/ecosystem/profiles/${repoId}/retry`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'manual_retry' }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ecosystem', 'profiles'] });
      qc.invalidateQueries({ queryKey: ['ecosystem', 'repo-full'] });
    },
  });
}

// ============================================================
// v1.5.0-E: Lifecycle batch dispatch (deep_review_request_batch)
// ============================================================

export interface LifecycleBatchIntent {
  repo_id: string;
  repo_full_name: string;
  deep_review_id: string;
  prompt: string;
  timeout_seconds: number;
  project_id: string | null;
}

export interface LifecycleBatchResponse {
  success: boolean;
  dispatched: number;
  intents: LifecycleBatchIntent[];
}

export interface LifecycleBatchInput {
  tags: string[];
  min_stars?: number | null;
  limit?: number;
  research_goal?: string;
}

export function useLifecycleRequestBatch() {
  return useMutation({
    mutationFn: async (input: LifecycleBatchInput) =>
      apiFetch<LifecycleBatchResponse>(`/api/ecosystem/lifecycle/request_batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tags: input.tags,
          min_stars: input.min_stars ?? null,
          limit: input.limit ?? 20,
          research_goal: input.research_goal ?? '',
        }),
      }),
  });
}
