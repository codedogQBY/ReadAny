import { useColors, withOpacity } from "@/styles/theme";
/**
 * GoalsSection.tsx — Mobile goal progress rings + inline add form.
 * Feature-parity with desktop GoalsSection (packages/app/src/components/stats/GoalsSection.tsx).
 */
import type { GoalPeriod, GoalProgress, GoalType, StatsDimension } from "@readany/core/stats";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, { Circle } from "react-native-svg";
import { formatCharacterCount } from "./stats-utils";

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

export function GoalsSection({
  progress,
  onAddGoal,
  onRemoveGoal,
  currentDimension,
}: {
  progress: GoalProgress[];
  onAddGoal?: (type: GoalType, target: number, period: GoalPeriod) => void;
  onRemoveGoal?: (id: string) => void;
  currentDimension?: StatsDimension;
}) {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const [formOpen, setFormOpen] = useState(false);
  const isZh = i18n.language.startsWith("zh");
  const supportsGoalPeriod =
    currentDimension === undefined ||
    currentDimension === "month" ||
    currentDimension === "year";

  const defaultPeriod: GoalPeriod = currentDimension === "year" ? "yearly" : "monthly";

  const typeUnit = (type: GoalType) =>
    type === "books"
      ? t("stats.desktop.goalBooksUnit")
      : type === "time"
        ? t("stats.desktop.goalTimeUnit")
        : type === "characters"
          ? t("stats.desktop.goalCharactersUnit")
        : t("stats.desktop.goalPagesUnit");

  return (
    <View style={{ gap: 12 }}>
      {progress.map(({ goal, current, percentage, remaining, onTrack }) => (
        <GoalRow
          key={goal.id}
          current={current}
          percentage={percentage}
          remaining={remaining}
          onTrack={onTrack}
          periodLabel={
            goal.period === "monthly"
              ? t("stats.desktop.goalMonthly")
              : t("stats.desktop.goalYearly")
          }
          typeLabel={typeUnit(goal.type)}
          target={goal.target}
          isZh={isZh}
          onRemove={onRemoveGoal ? () => onRemoveGoal(goal.id) : undefined}
        />
      ))}

      {progress.length === 0 && (
        <Text
          style={{
            textAlign: "center",
            fontSize: 13,
            paddingVertical: 16,
            color: withOpacity(colors.mutedForeground, 0.62),
          }}
        >
          {t("stats.desktop.noGoals")}
        </Text>
      )}

      {onAddGoal && supportsGoalPeriod && (
        <TouchableOpacity
          onPress={() => setFormOpen(true)}
          activeOpacity={0.7}
          style={{
            borderWidth: StyleSheet.hairlineWidth,
            borderStyle: "dashed",
            borderColor: withOpacity(colors.border, 0.5),
            borderRadius: 12,
            paddingVertical: 12,
            alignItems: "center",
          }}
        >
          <Text
            style={{
              fontSize: 13,
              fontWeight: "500",
              color: withOpacity(colors.mutedForeground, 0.7),
            }}
          >
            + {t("stats.desktop.setGoal")}
          </Text>
        </TouchableOpacity>
      )}

      {supportsGoalPeriod && (
        <GoalAddFormModal
          visible={formOpen}
          defaultPeriod={defaultPeriod}
          onClose={() => setFormOpen(false)}
          onSubmit={(type, target, period) => {
            onAddGoal?.(type, target, period);
            setFormOpen(false);
          }}
        />
      )}
    </View>
  );
}

/* ─── Goal row with progress ring ─── */
function GoalRow({
  current,
  percentage,
  remaining,
  onTrack,
  periodLabel,
  typeLabel,
  target,
  isZh,
  onRemove,
}: {
  current: number;
  percentage: number;
  remaining: number;
  onTrack: boolean;
  periodLabel: string;
  typeLabel: string;
  target: number;
  isZh: boolean;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  const colors = useColors();

  const r = 30;
  const sw = 4;
  const size = 72;
  const circ = 2 * Math.PI * r;
  const dashOffset = circ - (percentage / 100) * circ;

  const ringColor =
    percentage >= 100
      ? "#10b981" // emerald
      : onTrack
        ? colors.primary
        : "#f59e0b"; // amber

  const statusText =
    percentage >= 100
      ? t("stats.desktop.goalComplete")
      : onTrack
        ? t("stats.desktop.goalOnTrack")
        : t("stats.desktop.goalBehindPace");

  const statusBg =
    percentage >= 100
      ? "rgba(16,185,129,0.12)"
      : onTrack
        ? withOpacity(colors.primary, 0.1)
        : "rgba(245,158,11,0.12)";

  const statusFg =
    percentage >= 100 ? "#059669" : onTrack ? withOpacity(colors.primary, 0.85) : "#d97706";

  const formatGoalValue = (value: number) => {
    if (typeLabel === t("stats.desktop.goalCharactersUnit")) {
      return formatCharacterCount(value, isZh);
    }

    const normalized = Math.round(value * 10) / 10;
    return `${normalized} ${typeLabel}`;
  };

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingHorizontal: 8,
        paddingVertical: 8,
      }}
    >
      {/* Progress ring */}
      <View
        style={{
          width: size,
          height: size,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Svg
          width={size}
          height={size}
          style={{ transform: [{ rotate: "-90deg" }] }}
        >
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={sw}
            stroke={withOpacity(colors.mutedForeground, 0.18)}
          />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={sw}
            stroke={ringColor}
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={dashOffset}
          />
        </Svg>
        <Text
          style={{
            position: "absolute",
            fontSize: 15,
            fontWeight: "700",
            color: withOpacity(colors.foreground, 0.88),
          }}
        >
          {percentage}%
        </Text>
      </View>

      {/* Info */}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Text
            style={{
              fontSize: 12,
              fontWeight: "600",
              color: withOpacity(colors.foreground, 0.82),
            }}
          >
            {periodLabel} · {typeLabel}
          </Text>
          <View
            style={{
              paddingHorizontal: 7,
              paddingVertical: 2,
              borderRadius: 999,
              backgroundColor: statusBg,
            }}
          >
            <Text style={{ fontSize: 10, fontWeight: "600", color: statusFg }}>
              {statusText}
            </Text>
          </View>
        </View>
        <Text
          style={{
            fontSize: 14,
            fontWeight: "700",
            color: withOpacity(colors.foreground, 0.88),
            fontVariant: ["tabular-nums"],
          }}
        >
          {formatGoalValue(current)} / {formatGoalValue(target)}
        </Text>
        {percentage < 100 && (
          <Text
            style={{
              fontSize: 11,
              color: withOpacity(colors.mutedForeground, 0.65),
            }}
          >
            {t("stats.desktop.goalRemaining", {
              remaining: formatGoalValue(remaining),
            })}
          </Text>
        )}
      </View>

      {/* Remove */}
      {onRemove && (
        <TouchableOpacity
          onPress={onRemove}
          hitSlop={8}
          style={{ paddingHorizontal: 6, paddingVertical: 4 }}
        >
          <Text
            style={{
              fontSize: 11,
              color: withOpacity(colors.mutedForeground, 0.55),
            }}
          >
            {t("stats.desktop.removeGoal")}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

/* ─── Add form modal ─── */
function GoalAddFormModal({
  visible,
  defaultPeriod,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  defaultPeriod: GoalPeriod;
  onClose: () => void;
  onSubmit: (type: GoalType, target: number, period: GoalPeriod) => void;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  const [type, setType] = useState<GoalType>("books");
  const [target, setTarget] = useState(formatGoalInputValue("books", GOAL_TYPE_DEFAULTS.books));

  useEffect(() => {
    if (visible) {
      setType("books");
      setTarget(formatGoalInputValue("books", GOAL_TYPE_DEFAULTS.books));
    }
  }, [visible, defaultPeriod]);

  const typeOptions: { key: GoalType; label: string }[] = [
    { key: "books", label: t("stats.desktop.goalBooks") },
    { key: "time", label: t("stats.desktop.goalTime") },
    { key: "characters", label: t("stats.desktop.goalCharacters") },
  ];

  const unitLabel =
    type === "books"
      ? t("stats.desktop.goalBooksUnit")
      : type === "time"
        ? t("stats.desktop.goalTimeUnit")
        : type === "characters"
          ? t("stats.desktop.goalCharactersInputUnit")
        : t("stats.desktop.goalPagesUnit");

  const periodLabel =
    defaultPeriod === "monthly"
      ? t("stats.desktop.goalMonthly")
      : t("stats.desktop.goalYearly");

  const handleTypeChange = (next: GoalType) => {
    setType(next);
    setTarget(formatGoalInputValue(next, GOAL_TYPE_DEFAULTS[next]));
  };

  const handleSubmit = () => {
    const n = parseGoalInputValue(type, target);
    if (Number.isFinite(n) && n > 0) {
      onSubmit(type, n, defaultPeriod);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.5)",
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 20,
          }}
        >
          <Pressable onPress={onClose} style={StyleSheet.absoluteFill} />
          <View
            style={{
              width: "100%",
              maxWidth: 360,
              borderRadius: 20,
              backgroundColor: colors.card,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: withOpacity(colors.border, 0.5),
              padding: 18,
              gap: 16,
            }}
          >
          <Text
            style={{
              fontSize: 16,
              fontWeight: "700",
              color: colors.foreground,
              textAlign: "center",
            }}
          >
            {t("stats.desktop.setGoal")}
          </Text>

          <View style={{ gap: 6 }}>
            <Text
              style={{
                fontSize: 11,
                fontWeight: "500",
                letterSpacing: 1.2,
                textTransform: "uppercase",
                color: withOpacity(colors.mutedForeground, 0.55),
              }}
            >
              {periodLabel} · {t("stats.desktop.goalTarget")}
            </Text>
          </View>

          {/* Type picker */}
          <View style={{ flexDirection: "row", gap: 6 }}>
            {typeOptions.map((opt) => (
              <TouchableOpacity
                key={opt.key}
                onPress={() => handleTypeChange(opt.key)}
                activeOpacity={0.7}
                style={{
                  flex: 1,
                  paddingVertical: 8,
                  borderRadius: 8,
                  alignItems: "center",
                  backgroundColor:
                    type === opt.key
                      ? withOpacity(colors.primary, 0.1)
                      : withOpacity(colors.muted, 0.3),
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: "500",
                    color:
                      type === opt.key
                        ? colors.primary
                        : withOpacity(colors.mutedForeground, 0.7),
                  }}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Target input */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <TextInput
              value={target}
              onChangeText={setTarget}
              keyboardType="decimal-pad"
              selectTextOnFocus
              style={{
                width: 96,
                height: 38,
                borderRadius: 8,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: withOpacity(colors.border, 0.5),
                backgroundColor: withOpacity(colors.muted, 0.2),
                paddingHorizontal: 10,
                textAlign: "center",
                fontSize: 15,
                fontWeight: "700",
                color: colors.foreground,
              }}
            />
            <Text
              style={{
                fontSize: 13,
                color: withOpacity(colors.mutedForeground, 0.7),
              }}
            >
              {unitLabel} / {periodLabel}
            </Text>
          </View>

          {/* Actions */}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TouchableOpacity
              onPress={onClose}
              activeOpacity={0.7}
              style={{
                paddingHorizontal: 16,
                paddingVertical: 10,
                borderRadius: 10,
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: "500",
                  color: withOpacity(colors.mutedForeground, 0.72),
                }}
              >
                {t("stats.desktop.goalCancel")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSubmit}
              activeOpacity={0.85}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 10,
                alignItems: "center",
                backgroundColor: colors.primary,
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: "600",
                  color: colors.primaryForeground,
                }}
              >
                {t("stats.desktop.setGoal")}
              </Text>
            </TouchableOpacity>
          </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
