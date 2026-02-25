/**
 * VectorProgress — circular progress ring
 */
import type { VectorizeProgress } from "@/types";

interface VectorProgressProps {
  progress: VectorizeProgress;
  size?: number;
}

export function VectorProgress({ progress, size = 64 }: VectorProgressProps) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio =
    progress.totalChunks > 0
      ? progress.processedChunks / progress.totalChunks
      : 0;
  const offset = circumference * (1 - ratio);

  return (
    <div className="flex items-center justify-center">
      <svg width={size} height={size} className="rotate-[-90deg]">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          className="text-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          className="text-primary transition-all"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span className="absolute text-xs font-medium">
        {Math.round(ratio * 100)}%
      </span>
    </div>
  );
}
