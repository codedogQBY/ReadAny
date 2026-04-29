/**
 * StatsShared.tsx — Shared UI primitives for the Stats page.
 * Small, focused components with consistent styling tokens.
 */
import { useResolvedSrc } from "@/hooks/use-resolved-src";
import { cn } from "@readany/core/utils";
import type { ReactNode } from "react";
import type { MetricTileData } from "./stats-utils";

/* ─── Card ─── */

export function StatsCard({
  children,
  className,
  variant = "default",
}: {
  children: ReactNode;
  className?: string;
  variant?: "default" | "featured";
}) {
  return (
    <section
      className={cn(
        "min-w-0 overflow-hidden rounded-2xl border px-5 py-5 sm:px-6 sm:py-5",
        variant === "default"
          ? "border-border/30 bg-card/90"
          : "border-primary/10 bg-gradient-to-br from-card via-card to-primary/[0.02]",
        className,
      )}
    >
      {children}
    </section>
  );
}

/* ─── Section header ─── */

export function SectionHeader({
  title,
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  if (!title && !action) {
    return null;
  }

  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        {title ? (
          <h2 className="text-[15px] font-semibold tracking-tight text-foreground/90">{title}</h2>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/* ─── Metric tile ─── */

export function MetricTile({ metric }: { metric: MetricTileData }) {
  return (
    <div className="group min-w-0 rounded-xl bg-muted/[0.12] px-3.5 py-3 transition-colors hover:bg-muted/[0.2]">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/60">
        <span className="text-primary/35 transition-colors group-hover:text-primary/55">
          {metric.icon}
        </span>
        <span>{metric.label}</span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="truncate text-[20px] font-bold tabular-nums tracking-tight text-foreground/85 transition-colors group-hover:text-foreground">
          {metric.value}
        </span>
        {metric.deltaLabel && metric.delta !== undefined && metric.delta !== 0 && (
          <span
            className={cn(
              "shrink-0 text-[11px] font-semibold tabular-nums",
              metric.delta > 0 ? "text-emerald-500/70" : "text-red-400/70",
            )}
          >
            {metric.delta > 0 ? "↑" : "↓"} {metric.deltaLabel}
          </span>
        )}
      </div>
      {metric.sublabel && (
        <p className="mt-0.5 text-[12px] text-muted-foreground/55">{metric.sublabel}</p>
      )}
    </div>
  );
}

/* ─── Empty state ─── */

export function EmptyState({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: ReactNode;
}) {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center gap-5 text-center">
      <div className="rounded-2xl border border-border/30 bg-muted/20 p-5">{icon}</div>
      <div className="space-y-1.5">
        <h3 className="text-base font-semibold text-foreground/75">{title}</h3>
        <p className="max-w-sm text-[13px] leading-relaxed text-muted-foreground/65">
          {description}
        </p>
      </div>
    </div>
  );
}

/* ─── Cover thumbnail ─── */

export function CoverThumb({
  title,
  coverUrl,
  className,
  fallbackClassName,
}: {
  title: string;
  coverUrl?: string;
  className?: string;
  fallbackClassName?: string;
}) {
  const resolved = useResolvedSrc(coverUrl);

  return (
    <div className={cn("overflow-hidden bg-muted/40", className)}>
      {resolved ? (
        <img src={resolved} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <div
          className={cn(
            "flex h-full w-full items-center justify-center bg-gradient-to-br from-muted/60 to-muted/30 text-center text-[10px] font-semibold text-muted-foreground/55",
            fallbackClassName,
          )}
        >
          {title.trim().slice(0, 1)}
        </div>
      )}
    </div>
  );
}
