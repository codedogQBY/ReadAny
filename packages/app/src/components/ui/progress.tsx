import { cn } from "@readany/core/utils";

interface ProgressProps {
  /** Percentage from 0 to 100; omit when progress is unknown. */
  value?: number | null;
  className?: string;
  "aria-label": string;
}

export function Progress({ value, className, "aria-label": label }: ProgressProps) {
  const percent =
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(100, Math.max(0, value))
      : undefined;
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}>
      <progress className="sr-only" value={percent} max={100} aria-label={label} />
      <div
        aria-hidden="true"
        className={cn(
          "h-full rounded-full bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none",
          percent === undefined && "animate-pulse motion-reduce:animate-none",
        )}
        style={{ width: `${percent ?? 100}%` }}
      />
    </div>
  );
}
