/**
 * QuotaDisplay — shows usage quota (AI messages, vectorize, translation)
 */
import type { Quota } from "@/types";

interface QuotaDisplayProps {
  quota: Quota;
}

export function QuotaDisplay({ quota }: QuotaDisplayProps) {
  const percentage = quota.limit > 0 ? (quota.used / quota.limit) * 100 : 0;
  const isNearLimit = percentage >= 80;

  return (
    <div className="flex items-center gap-3 rounded-md border border-border p-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium capitalize">{quota.type.replace("_", " ")}</span>
          <span className={isNearLimit ? "text-destructive" : "text-muted-foreground"}>
            {quota.used} / {quota.limit}
          </span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-all ${
              isNearLimit ? "bg-destructive" : "bg-primary"
            }`}
            style={{ width: `${Math.min(100, percentage)}%` }}
          />
        </div>
      </div>
    </div>
  );
}
