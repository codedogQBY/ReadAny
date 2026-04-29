/**
 * GoalsSection.tsx — Goal progress rings and inline goal form.
 */
import type { GoalProgress, StatsDimension } from "@readany/core/stats";
import { cn } from "@readany/core/utils";
import { useState } from "react";
import type { StatsCopy } from "./stats-copy";
import { formatCharacterCount } from "./stats-utils";

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  Goals Section — progress rings + inline goal form
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

type GoalType = "books" | "time" | "characters" | "pages";
type GoalPeriod = "monthly" | "yearly";

const GOAL_TYPE_DEFAULTS: Record<GoalType, number> = {
  books: 24,
  time: 100,
  characters: 300000,
  pages: 5000,
};
const CHARACTER_GOAL_SCALE = 10000;

function formatGoalInputValue(type: GoalType, target: number): string {
  if (type === "characters") {
    const normalized = Math.round((target / CHARACTER_GOAL_SCALE) * 10) / 10;
    return `${normalized}`.replace(/\.0$/, "");
  }
  return String(target);
}

function parseGoalInputValue(type: GoalType, value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return type === "characters" ? Math.round(parsed * CHARACTER_GOAL_SCALE) : parsed;
}

function GoalAddForm({
  copy,
  onSubmit,
  onCancel,
  period,
}: {
  copy: StatsCopy;
  onSubmit: (type: GoalType, target: number, period: GoalPeriod) => void;
  onCancel: () => void;
  period: GoalPeriod;
}) {
  const [type, setType] = useState<GoalType>("books");
  const [target, setTarget] = useState(formatGoalInputValue("books", GOAL_TYPE_DEFAULTS.books));

  const typeOptions: { key: GoalType; label: string }[] = [
    { key: "books", label: copy.goalBooks },
    { key: "time", label: copy.goalTime },
    { key: "characters", label: copy.goalCharacters },
  ];

  const handleTypeChange = (t: GoalType) => {
    setType(t);
    setTarget(formatGoalInputValue(t, GOAL_TYPE_DEFAULTS[t]));
  };

  const handleSubmit = () => {
    const val = parseGoalInputValue(type, target);
    if (val > 0) onSubmit(type, val, period);
  };

  const periodLabel = period === "yearly" ? copy.goalYearly : copy.goalMonthly;

  return (
    <div className="space-y-4 rounded-xl border border-border/30 bg-muted/[0.06] p-4">
      {/* Type picker */}
      <div className="space-y-1.5">
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/55">
          {periodLabel} · {copy.goalTarget}
        </div>
        <div className="flex gap-1.5">
          {typeOptions.map((opt) => (
            <button
              key={opt.key}
              onClick={() => handleTypeChange(opt.key)}
              className={cn(
                "flex-1 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all",
                type === opt.key
                  ? "bg-primary/10 text-primary shadow-sm"
                  : "bg-background/50 text-muted-foreground/65 hover:text-foreground/80",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Target input */}
      <div className="flex items-center gap-3">
        <input
          type="number"
          min={1}
          step={type === "characters" ? 0.1 : 1}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="h-9 w-24 rounded-lg border border-border/30 bg-background/50 px-3 text-center text-[15px] font-bold tabular-nums text-foreground outline-none transition-colors focus:border-primary/30 focus:ring-1 focus:ring-primary/15"
        />
        <span className="text-[13px] text-muted-foreground/65">
          {type === "books"
            ? copy.goalBooksUnit
            : type === "time"
              ? copy.goalTimeUnit
              : type === "characters"
                ? copy.goalCharactersInputUnit
                : copy.goalPagesUnit}
          {" / "}
          {periodLabel.toLowerCase()}
        </span>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          className="flex-1 rounded-lg bg-primary/90 px-4 py-2 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary"
        >
          {copy.setGoal}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg px-4 py-2 text-[13px] font-medium text-muted-foreground/72 transition-colors hover:bg-muted/20"
        >
          {copy.goalCancel}
        </button>
      </div>
    </div>
  );
}

export function GoalsSection({
  progress,
  copy,
  onAddGoal,
  onRemoveGoal,
  currentDimension,
}: {
  progress: GoalProgress[];
  copy: StatsCopy;
  onAddGoal?: (type: GoalType, target: number, period: GoalPeriod) => void;
  onRemoveGoal?: (id: string) => void;
  currentDimension?: StatsDimension;
}) {
  const [showForm, setShowForm] = useState(false);
  const isZh = copy.goalCharactersUnit === "字";

  // Auto-determine default period from current stats dimension
  const defaultPeriod: GoalPeriod = currentDimension === "year" ? "yearly" : "monthly";

  const goalTypeLabel = (type: string) =>
    type === "books"
      ? copy.goalBooksUnit
      : type === "time"
        ? copy.goalTimeUnit
        : type === "characters"
          ? copy.goalCharactersUnit
          : copy.goalPagesUnit;

  const handleSubmit = (type: GoalType, target: number, period: GoalPeriod) => {
    onAddGoal?.(type, target, period);
    setShowForm(false);
  };

  const formatGoalValue = (value: number, type: string) => {
    if (type === "characters") {
      return formatCharacterCount(value, isZh);
    }

    const normalized = Math.round(value * 10) / 10;
    return `${normalized} ${goalTypeLabel(type)}`;
  };

  return (
    <div className="space-y-4">
      {/* Existing goals */}
      {progress.map(({ goal, current, percentage, remaining, onTrack }) => {
        const r = 36;
        const sw = 5;
        const circ = 2 * Math.PI * r;
        const dashOffset = circ - (percentage / 100) * circ;
        const ringColor =
          percentage >= 100
            ? "stroke-emerald-500/80"
            : onTrack
              ? "stroke-primary/60"
              : "stroke-amber-400/60";

        return (
          <div
            key={goal.id}
            className="group flex items-center gap-5 rounded-xl px-4 py-4 transition-colors hover:bg-muted/[0.08]"
          >
            {/* Progress ring */}
            <div className="relative flex-shrink-0">
              <svg width={86} height={86} className="-rotate-90">
                <circle
                  cx={43}
                  cy={43}
                  r={r}
                  fill="none"
                  strokeWidth={sw}
                  className="stroke-muted/25"
                />
                <circle
                  cx={43}
                  cy={43}
                  r={r}
                  fill="none"
                  strokeWidth={sw}
                  strokeLinecap="round"
                  strokeDasharray={circ}
                  strokeDashoffset={dashOffset}
                  className={cn("transition-all duration-700", ringColor)}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[18px] font-bold tabular-nums text-foreground/85">
                  {percentage}%
                </span>
              </div>
            </div>

            {/* Info */}
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-foreground/80">
                  {goal.period === "monthly" ? copy.goalMonthly : copy.goalYearly} ·{" "}
                  {goalTypeLabel(goal.type)}
                </span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium",
                    percentage >= 100
                      ? "bg-emerald-500/10 text-emerald-600"
                      : onTrack
                        ? "bg-primary/8 text-primary/70"
                        : "bg-amber-400/10 text-amber-600",
                  )}
                >
                  {percentage >= 100
                    ? copy.goalComplete
                    : onTrack
                      ? copy.goalOnTrack
                      : copy.goalBehindPace}
                </span>
              </div>
              <div className="text-[15px] font-bold tabular-nums text-foreground/85">
                {formatGoalValue(current, goal.type)} / {formatGoalValue(goal.target, goal.type)}
              </div>
              {percentage < 100 && (
                <div className="text-[12px] text-muted-foreground/62">
                  {copy.goalRemaining.replace(
                    "{{remaining}}",
                    formatGoalValue(remaining, goal.type),
                  )}
                </div>
              )}
            </div>

            {/* Remove */}
            {onRemoveGoal && (
              <button
                onClick={() => onRemoveGoal(goal.id)}
                className="shrink-0 rounded-lg px-2 py-1 text-[11px] text-muted-foreground/52 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive/70 group-hover:opacity-100"
              >
                {copy.removeGoal}
              </button>
            )}
          </div>
        );
      })}

      {/* Empty state */}
      {progress.length === 0 && !showForm && (
        <p className="py-4 text-center text-[13px] text-muted-foreground/62">{copy.noGoals}</p>
      )}

      {/* Add goal form / button */}
      {showForm ? (
        <GoalAddForm
          copy={copy}
          onSubmit={handleSubmit}
          onCancel={() => setShowForm(false)}
          period={defaultPeriod}
        />
      ) : onAddGoal ? (
        <button
          onClick={() => setShowForm(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border/30 py-3 text-[13px] font-medium text-muted-foreground/65 transition-colors hover:border-primary/20 hover:bg-primary/[0.02] hover:text-primary/70"
        >
          + {copy.setGoal}
        </button>
      ) : null}
    </div>
  );
}
