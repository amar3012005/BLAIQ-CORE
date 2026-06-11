import { Search, Star, Filter, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { CATEGORY_LABELS, RELEVANCE_CATEGORIES } from '@/api/ecosystem';
import type { EcosystemFilters, EcosystemFacetCounts } from '@/api/ecosystem';

interface FilterBarProps {
  /** 当前筛选条件 */
  filters: EcosystemFilters;
  /** 筛选条件变更回调 */
  onChange: (next: EcosystemFilters) => void;
  /** 命中数量（用于展示） */
  totalCount?: number;
  /** 后端 facet 聚合（启用时类别筛选项后跟数量） */
  facetCounts?: EcosystemFacetCounts;
}

const STAR_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: '不限星标' },
  { value: 100, label: '≥ 100' },
  { value: 1000, label: '≥ 1k' },
  { value: 5000, label: '≥ 5k' },
  { value: 15000, label: '≥ 15k' },
  { value: 50000, label: '≥ 50k' },
];

const ALL = '__all__';

/**
 * 列表页筛选栏 — 关键词搜索 + 类别 + 星标阈值 + 深扫状态。
 * 移动端单列堆叠，桌面端横向铺开。
 */
export function FilterBar({ filters, onChange, totalCount, facetCounts }: FilterBarProps) {
  const categoryFacets = facetCounts?.category ?? {};
  const update = (patch: Partial<EcosystemFilters>) => {
    onChange({ ...filters, ...patch });
  };

  const resetAll = () => {
    onChange({ limit: filters.limit ?? 200 });
  };

  const hasActiveFilter = Boolean(
    filters.keyword ||
      filters.topic ||
      filters.category ||
      (filters.minStars && filters.minStars > 0) ||
      filters.stageStatus,
  );

  // 类别 trigger 显示文本
  const categoryLabel = filters.category
    ? (CATEGORY_LABELS[filters.category] ?? filters.category)
    : '全部类别';

  // 星标 trigger 显示文本
  const minStarsValue = filters.minStars ?? 0;
  const starLabel = STAR_OPTIONS.find((o) => o.value === minStarsValue)?.label ?? '不限星标';

  // 研究阶段 trigger 显示文本（v1.5.0 漏斗 3 类互斥，对齐 StatsBar 数字）
  const STAGE_LABELS: Record<string, string> = {
    queued: '待浅扫',
    shallow_done: '已浅扫',
    'architecture_done,debated,referenced,integrated': '已深扫',
  };
  const stageLabel = filters.stageStatus
    ? (STAGE_LABELS[filters.stageStatus] ?? filters.stageStatus)
    : '全部研究阶段';

  return (
    <div className="flex flex-col gap-3 p-4 border-b bg-muted/20">
      {/* 第一行：搜索框 + 命中计数 */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            placeholder="搜索仓库名 / owner / 描述..."
            value={filters.keyword ?? ''}
            onChange={(e) => update({ keyword: e.target.value })}
            className="pl-9 h-9"
            aria-label="搜索仓库"
          />
        </div>
        {typeof totalCount === 'number' && (
          <div className="text-sm text-muted-foreground whitespace-nowrap">
            共 <span className="font-semibold text-foreground">{totalCount}</span> 个仓库
          </div>
        )}
      </div>

      {/* 第二行：维度筛选 */}
      <div className="flex flex-wrap items-center gap-2">
        {/* 类别筛选 */}
        <Select
          value={filters.category || ALL}
          onValueChange={(v) => update({ category: !v || v === ALL ? '' : v })}
        >
          <SelectTrigger className="h-8 min-w-[150px] text-sm" aria-label="筛选类别">
            <Filter className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{categoryLabel}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>
              全部类别
              {facetCounts && (
                <span className="ml-1 text-xs text-muted-foreground">
                  ({Object.values(categoryFacets).reduce((s, n) => s + n, 0)})
                </span>
              )}
            </SelectItem>
            {RELEVANCE_CATEGORIES.map((cat) => {
              const cnt = categoryFacets[cat] ?? 0;
              return (
                <SelectItem key={cat} value={cat}>
                  {CATEGORY_LABELS[cat] ?? cat}
                  {facetCounts && (
                    <span className="ml-1 text-xs text-muted-foreground">({cnt})</span>
                  )}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        {/* 星标阈值 */}
        <Select
          value={String(minStarsValue)}
          onValueChange={(v) => update({ minStars: Number(v) })}
        >
          <SelectTrigger className="h-8 min-w-[140px] text-sm" aria-label="星标阈值">
            <Star className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{starLabel}</span>
          </SelectTrigger>
          <SelectContent>
            {STAR_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={String(opt.value)}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* 研究阶段（v1.5.0 漏斗 4 类）*/}
        <Select
          value={filters.stageStatus || ALL}
          onValueChange={(v) =>
            update({
              stageStatus: !v || v === ALL ? '' : v,
            })
          }
        >
          <SelectTrigger className="h-8 min-w-[160px] text-sm" aria-label="研究阶段">
            <span className="truncate">{stageLabel}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>全部研究阶段</SelectItem>
            <SelectItem value="queued">待浅扫</SelectItem>
            <SelectItem value="shallow_done">已浅扫</SelectItem>
            <SelectItem value="architecture_done,debated,referenced,integrated">已深扫</SelectItem>
          </SelectContent>
        </Select>

        {/* TODO(Stage E v2): 增加 has_deep_review / is_archived / tags 多选筛选 */}

        {hasActiveFilter && (
          <Button
            variant="ghost"
            size="sm"
            onClick={resetAll}
            className="h-8 ml-auto text-muted-foreground"
            aria-label="清除所有筛选"
          >
            <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            清除
          </Button>
        )}
      </div>
    </div>
  );
}
