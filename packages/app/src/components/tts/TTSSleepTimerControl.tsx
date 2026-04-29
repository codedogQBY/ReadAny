import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTTSStore } from "@/stores/tts-store";
import { Clock3 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const PRESET_MINUTES = [15, 30, 45, 60] as const;

function formatRemainingLabel(endsAt: number | null): string | null {
  if (!endsAt) return null;
  const remainingMs = Math.max(0, endsAt - Date.now());
  if (remainingMs <= 0) return null;
  const totalSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

interface TTSSleepTimerControlProps {
  compact?: boolean;
}

export function TTSSleepTimerControl({ compact = false }: TTSSleepTimerControlProps) {
  const { t } = useTranslation();
  const sleepTimerEndsAt = useTTSStore((s) => s.sleepTimerEndsAt);
  const sleepTimerDurationMinutes = useTTSStore((s) => s.sleepTimerDurationMinutes);
  const setSleepTimer = useTTSStore((s) => s.setSleepTimer);
  const clearSleepTimer = useTTSStore((s) => s.clearSleepTimer);
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState(false);
  const [customMinutes, setCustomMinutes] = useState(
    sleepTimerDurationMinutes ? String(sleepTimerDurationMinutes) : "30",
  );
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!sleepTimerEndsAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [sleepTimerEndsAt]);

  useEffect(() => {
    if (!open) return;
    setCustomMinutes(sleepTimerDurationMinutes ? String(sleepTimerDurationMinutes) : "30");
  }, [open, sleepTimerDurationMinutes]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const remainingLabel = useMemo(() => {
    void now;
    return formatRemainingLabel(sleepTimerEndsAt);
  }, [now, sleepTimerEndsAt]);

  const applyCustomMinutes = () => {
    const parsed = Number.parseInt(customMinutes.trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    setSleepTimer(parsed);
    setOpen(false);
  };

  return (
    <div className="relative" ref={rootRef}>
      <Button
        variant="ghost"
        size="icon"
        className={
          compact
            ? `h-9 w-9 rounded-lg border border-border/60 transition-colors ${
                remainingLabel
                  ? "border-primary/30 bg-primary/12 text-primary hover:bg-primary/18"
                  : "bg-muted/80 text-foreground hover:bg-muted"
              }`
            : `h-8 w-8 rounded-full border border-border/60 transition-colors ${
                remainingLabel
                  ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/16"
                  : "bg-muted/80 text-foreground hover:bg-muted"
              }`
        }
        aria-label={t("tts.sleepTimer", "定时停止")}
        title={
          remainingLabel
            ? `${t("tts.sleepTimer", "定时停止")} · ${remainingLabel}`
            : t("tts.sleepTimer", "定时停止")
        }
        onClick={() => setOpen((value) => !value)}
      >
        <Clock3 className={compact ? "h-3.5 w-3.5" : "h-3.5 w-3.5"} />
      </Button>

      {open ? (
        <div className="absolute bottom-full right-0 z-[10030] mb-2 w-64 rounded-2xl border border-border/70 bg-card p-3 shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-primary" />
                <span className="text-xs font-semibold text-foreground">
                  {t("tts.sleepTimer", "定时停止")}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                {remainingLabel
                  ? t("tts.sleepTimerRemaining", {
                      time: remainingLabel,
                      defaultValue: `Remaining ${remainingLabel}`,
                    })
                  : t("tts.sleepTimerSubtitle", "让朗读在你设定的时间后自动停止")}
              </p>
            </div>

            <div className="flex min-h-8 min-w-[74px] items-center justify-center rounded-full border border-border/70 bg-background/90 px-3 text-[11px] font-semibold text-foreground">
              {remainingLabel || t("common.settings", "设置")}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {PRESET_MINUTES.map((minutes) => {
              const isActive = sleepTimerEndsAt && sleepTimerDurationMinutes === minutes;
              return (
                <Button
                  key={minutes}
                  type="button"
                  variant={isActive ? "default" : "secondary"}
                  size="sm"
                  className="h-8 rounded-full px-3 text-xs"
                  onClick={() => {
                    setSleepTimer(minutes);
                    setOpen(false);
                  }}
                >
                  {t("tts.sleepTimerPresetShort", { minutes, defaultValue: `${minutes} 分钟` })}
                </Button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              value={customMinutes}
              onChange={(event) => setCustomMinutes(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  applyCustomMinutes();
                }
              }}
              className="h-8 text-xs"
              placeholder={t("tts.sleepTimerCustomPlaceholder", "自定义分钟数")}
            />
            <Button
              type="button"
              size="sm"
              className="h-8 rounded-full px-3 text-xs"
              onClick={applyCustomMinutes}
            >
              {t("tts.sleepTimerApply", "开始计时")}
            </Button>
          </div>

          {sleepTimerEndsAt ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-3 h-8 rounded-full px-3 text-xs text-muted-foreground"
              onClick={() => {
                clearSleepTimer();
                setOpen(false);
              }}
            >
              {t("tts.sleepTimerCancel", "关闭定时")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
