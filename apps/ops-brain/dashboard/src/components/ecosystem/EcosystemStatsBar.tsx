import { useMemo } from 'react';
import { Boxes, FileSearch, Archive, Tag, FolderOpen, Folder } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { EcosystemRepoProfile, EcosystemFacetCounts } from '@/api/ecosystem';
import { CATEGORY_LABELS } from '@/api/ecosystem';
import { useProject } from '@/context/ProjectContext';

interface EcosystemStatsBarProps {
  /** 完整列表（filter 之前），用于计算待深扫/失活/总数 */
  allProfiles: EcosystemRepoProfile[];
  /** 后端 facet_counts（启用 facetCounts=true 时返回） */
  facetCounts?: EcosystemFacetCounts;
  /** 后端汇报的总数（带后端筛选后的结果数） */
  total?: number;
}

/** 单个统计卡片 */
function StatCard({
  Icon,
  label,
  value,
  hint,
  tone = 'default',
}: {
  Icon: typeof Boxes;
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'default' | 'primary' | 'warning' | 'info';
}) {
  const toneClass: Record<string, string> = {
    default: 'text-foreground',
    primary: 'text-primary',
    warning: 'text-amber-600 dark:text-amber-400',
    info: 'text-blue-600 dark:text-blue-400',
  };
  return (
    <Card className="px-3 py-2 flex flex-col gap-0.5 min-w-0 flex-1">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <Icon className="h-3 w-3" aria-hidden="true" />
        {label}
      </span>
      <span className={`text-xl font-semibold leading-none ${toneClass[tone]}`}>
        {value}
      </span>
      {hint && (
        <span className="text-[10px] text-muted-foreground truncate" title={hint}>
          {hint}
        </span>
      )}
    </Card>
  );
}

/**
 * 统计条 — 列表页顶部的项目+全局指标视图。
 *
 * 语义说明（Release blocker 修复）：
 *   - 已深扫 = EcosystemDeepReview.status='completed' 真实行数（不是 needs_deep_review=False）
 *   - 待深扫 = profile.needs_deep_review=True 的仓数
 *   - 失活 = is_archived=True 或 last_commit_at > 365 天
 *   - 覆盖率 = 已深扫 / 总仓数
 *
 * 之前的 bug：用 `profile.needs_deep_review === false` 等同于"已深扫"导致显示 163，
 * 但真实只有 3 条 completed DeepReview。"needs_deep_review" 语义是"是否需要被深扫"，
 * false 包含了"低相关性自动跳过"和"已完成"两种情况，不能等同于已深扫。
 */
export function EcosystemStatsBar({
  allProfiles,
  facetCounts,
  total,
}: EcosystemStatsBarProps) {
  const { projectName } = useProject();

  const stats = useMemo(() => {
    const totalCount = total ?? allProfiles.length;
    const needsDeepCount = allProfiles.filter((p) => p.needs_deep_review).length;
    // 失活：archived 或 last_commit_at 超过 365 天
    const now = Date.now();
    const archivedCount = allProfiles.filter((p) => {
      if (p.is_archived) return true;
      if (!p.last_commit_at) return false;
      const days = (now - new Date(p.last_commit_at).getTime()) / (1000 * 60 * 60 * 24);
      return days > 365;
    }).length;
    return { totalCount, needsDeepCount, archivedCount };
  }, [allProfiles, total]);

  // Top 3 类别（按命中数量降序）
  const topCategories = useMemo(() => {
    if (!facetCounts?.category) return [];
    return Object.entries(facetCounts.category)
      .filter(([, n]) => n > 0)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3);
  }, [facetCounts]);

  return (
    <div className="flex flex-col gap-2 px-4 pt-3">
      {/* 当前项目 chip — 让用户始终知道在看哪个项目的数据 */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">当前视图:</span>
        <Badge
          variant="outline"
          className={`text-xs gap-1 ${projectName ? 'border-primary/40 bg-primary/5 text-primary' : ''}`}
        >
          {projectName ? (
            <FolderOpen className="h-3 w-3" aria-hidden="true" />
          ) : (
            <Folder className="h-3 w-3" aria-hidden="true" />
          )}
          {projectName ?? '全部项目'}
        </Badge>
        {topCategories.length > 0 && (
          <>
            <span className="text-xs text-muted-foreground ml-2">Top 类别:</span>
            <div className="flex items-center gap-1 flex-wrap">
              {topCategories.map(([cat, n]) => (
                <Badge key={cat} variant="secondary" className="text-[10px] gap-1">
                  <Tag className="h-2.5 w-2.5" aria-hidden="true" />
                  {CATEGORY_LABELS[cat] ?? cat}
                  <span className="ml-0.5 opacity-70">{n}</span>
                </Badge>
              ))}
            </div>
          </>
        )}
      </div>

      {/* 数值卡片排（研究产物次数显示在 RepoCard stage 徽章，不重复在 stats）*/}
      <div className="flex flex-wrap gap-2">
        <StatCard
          Icon={Boxes}
          label="当前视图"
          value={stats.totalCount}
          hint="切「活跃集」或「全量」tab 改变范围"
          tone="default"
        />
        <StatCard
          Icon={FileSearch}
          label="待浅扫"
          value={stats.needsDeepCount}
          hint="尚未派 agent 浅扫总结"
          tone="info"
        />
        <StatCard
          Icon={Archive}
          label="失活仓"
          value={stats.archivedCount}
          hint="归档 或 365 天无提交"
          tone="warning"
        />
      </div>
    </div>
  );
}
