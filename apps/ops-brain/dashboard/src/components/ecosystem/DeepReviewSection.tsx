import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  FileSearch,
  Building2,
  ShieldAlert,
  Lightbulb,
  Beaker,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DEEP_REVIEW_STATUS_LABELS,
  INTEGRATION_RECOMMENDATION_LABELS,
} from '@/api/ecosystem';
import type { EcosystemDeepReview } from '@/api/ecosystem';
import { useReportDetail } from '@/api/reports';

interface DeepReviewSectionProps {
  reviews: EcosystemDeepReview[];
}

/** 状态徽章 */
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { className: string; Icon: typeof CheckCircle2 }> = {
    completed: {
      className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
      Icon: CheckCircle2,
    },
    running: { className: 'bg-blue-500/10 text-blue-600 border-blue-500/30', Icon: Loader2 },
    pending: { className: 'bg-muted text-muted-foreground border-border', Icon: Clock },
    failed: { className: 'bg-rose-500/10 text-rose-600 border-rose-500/30', Icon: XCircle },
    skipped: { className: 'bg-amber-500/10 text-amber-600 border-amber-500/30', Icon: XCircle },
  };
  const { className, Icon } = map[status] ?? map.pending;
  const label = DEEP_REVIEW_STATUS_LABELS[status] ?? status;
  return (
    <Badge variant="outline" className={`text-xs ${className}`}>
      <Icon className={`h-3 w-3 mr-1 ${status === 'running' ? 'animate-spin' : ''}`} aria-hidden="true" />
      {label}
    </Badge>
  );
}

/** 集成建议徽章 */
function RecommendationBadge({ rec }: { rec: string | null }) {
  if (!rec) return null;
  const styles: Record<string, string> = {
    adopt: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40',
    experiment: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/40',
    hold: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40',
    avoid: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40',
  };
  const label = INTEGRATION_RECOMMENDATION_LABELS[rec] ?? rec;
  return (
    <Badge variant="outline" className={`text-xs font-medium ${styles[rec] ?? ''}`}>
      建议：{label}
    </Badge>
  );
}

/** Markdown 子节渲染 — 折叠/展开。空字段时显示"暂无数据"占位而非整段隐藏。 */
function MarkdownBlock({
  title,
  Icon,
  body,
  hideWhenEmpty = false,
}: {
  title: string;
  Icon: typeof Building2;
  body: string;
  /** true 时空字段彻底不渲染（用于 demo log 这类可选块），默认 false 显示占位 */
  hideWhenEmpty?: boolean;
}) {
  const isEmpty = !body || !body.trim();
  if (isEmpty && hideWhenEmpty) return null;
  return (
    <section className="space-y-1.5">
      <h4 className="text-sm font-semibold flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        {title}
      </h4>
      <div className="md-prose text-sm max-w-none pl-5">
        {isEmpty ? (
          <p className="text-xs text-muted-foreground italic">暂无数据 — 后续深扫批次将填充</p>
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
        )}
      </div>
    </section>
  );
}

/** 单条深扫记录卡片 */
function ReviewCard({ review }: { review: EcosystemDeepReview }) {
  const [expanded, setExpanded] = useState(true);
  const [showFullReport, setShowFullReport] = useState(false);

  const { data: reportDetail, isLoading: reportLoading } = useReportDetail(
    showFullReport && review.report_id ? review.report_id : null,
  );

  const formatDate = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const hasAnyContent = useMemo(
    () =>
      Boolean(
        review.summary_md ||
          review.architecture_md ||
          review.risks_md ||
          review.learnings_md ||
          review.demo_log_excerpt,
      ),
    [review],
  );

  return (
    <div className="border rounded-md p-3 space-y-3 bg-card">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={review.status} />
          <RecommendationBadge rec={review.integration_recommendation} />
          <span className="text-xs text-muted-foreground">{formatDate(review.created_at)}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? '收起深扫详情' : '展开深扫详情'}
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
              收起
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
              展开
            </>
          )}
        </Button>
      </div>

      {expanded && (
        <div className="space-y-3">
          {!hasAnyContent && !review.report_id && review.status === 'running' && (
            <div className="flex items-start gap-2 text-xs text-blue-600 dark:text-blue-400 bg-blue-500/10 border border-blue-500/30 rounded p-2">
              <Loader2 className="h-3.5 w-3.5 mt-0.5 shrink-0 animate-spin" aria-hidden="true" />
              <span>深扫进行中 — 5 段式摘要将在完成后填充。可稍后刷新本页查看。</span>
            </div>
          )}
          {!hasAnyContent && !review.report_id && review.status === 'pending' && (
            <p className="text-xs text-muted-foreground italic">
              该深扫记录待启动，进入下一轮深扫批次后将自动开始。
            </p>
          )}

          <MarkdownBlock title="摘要" Icon={FileSearch} body={review.summary_md} />
          <MarkdownBlock title="架构" Icon={Building2} body={review.architecture_md} />
          <MarkdownBlock title="风险" Icon={ShieldAlert} body={review.risks_md} />
          <MarkdownBlock title="学习要点" Icon={Lightbulb} body={review.learnings_md} />

          {(review.demo_result || review.demo_log_excerpt) && (
            <section className="space-y-1.5">
              <h4 className="text-sm font-semibold flex items-center gap-1.5">
                <Beaker className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                Demo 运行
                {review.demo_result && (
                  <Badge variant="outline" className="text-[10px] ml-1">
                    {review.demo_result}
                  </Badge>
                )}
              </h4>
              {review.demo_log_excerpt && (
                <pre className="text-[11px] bg-muted/50 border rounded p-2 max-h-60 overflow-auto whitespace-pre-wrap break-words">
                  {review.demo_log_excerpt}
                </pre>
              )}
            </section>
          )}

          {review.report_id && (
            <div className="pt-2 border-t border-border/50">
              {!showFullReport ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => setShowFullReport(true)}
                >
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                  查看完整报告
                </Button>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">完整报告内容</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => setShowFullReport(false)}
                    >
                      收起
                    </Button>
                  </div>
                  {reportLoading ? (
                    <p className="text-xs text-muted-foreground">加载报告中...</p>
                  ) : reportDetail ? (
                    <div className="md-prose text-sm max-w-none border rounded p-3 bg-muted/30 max-h-96 overflow-auto">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {reportDetail.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">报告加载失败</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 深扫摘要区 — 展示该仓所有深扫记录（一般 1 条，最新优先）。
 */
export function DeepReviewSection({ reviews }: DeepReviewSectionProps) {
  if (!reviews || reviews.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileSearch className="h-4 w-4" aria-hidden="true" />
            深扫摘要
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          尚未对该仓库执行深度审查。被标记为"待深扫"的仓将在下一轮深扫批次中处理。
        </CardContent>
      </Card>
    );
  }

  // 按时间倒序
  const sorted = [...reviews].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <FileSearch className="h-4 w-4" aria-hidden="true" />
          深扫摘要 ({reviews.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {sorted.map((review) => (
          <ReviewCard key={review.id} review={review} />
        ))}
      </CardContent>
    </Card>
  );
}
