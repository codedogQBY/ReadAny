/**
 * useSocraticChat — 苏格拉底模式专用聊天 Hook
 *
 * 功能：
 * - 管理预热对话阶段（开场 → 联结 → 过渡 → 精读 → 回顾）
 * - 支持智能预热策略（auto/manual/smart）
 * - 处理命令解析（前端处理）
 * - 与标准聊天流程集成
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useSettingsStore } from "../stores/settings-store";
import type { Book, SemanticContext } from "../types";
import {
  type ParsedCommand,
  isCommand,
  isPreheatingCommand,
  isReadingCommand,
  parseCommand,
} from "./command-parser";
import { type SocraticConfig, SocraticDialogueManager } from "./socratic-dialogue-manager";
import type { PreheatingPhase } from "./socratic-prompt";

export interface SocraticChatOptions {
  book?: Book | null;
  semanticContext?: SemanticContext | null;
  bookId?: string;
  onPhaseChange?: (phase: PreheatingPhase) => void;
  onCommandExecuted?: (command: ParsedCommand, result: CommandResult) => void;
}

export interface CommandResult {
  success: boolean;
  message?: string;
  data?: unknown;
}

export interface SocraticChatState {
  phase: PreheatingPhase;
  manager: SocraticDialogueManager | null;
  isPreheatingComplete: boolean;
  shouldShowPreheatingUI: boolean;
  lastCommand: ParsedCommand | null;
}

export function useSocraticChat(options?: SocraticChatOptions) {
  const { book, semanticContext, onPhaseChange, onCommandExecuted } = options || {};

  const aiConfig = useSettingsStore((s) => s.aiConfig);
  const socraticSettings = aiConfig.socraticSettings || {
    enabled: false,
    mode: "socratic" as const,
    knowledgeScope: "current_chapter" as const,
    enablePreheating: true,
    preheatingStrategy: "smart" as const,
    enableWebSearch: false,
    questionComplexity: "medium" as const,
  };

  const [state, setState] = useState<SocraticChatState>({
    phase: "opening",
    manager: null,
    isPreheatingComplete: false,
    shouldShowPreheatingUI: false,
    lastCommand: null,
  });

  const sessionCountRef = useRef(0);

  useEffect(() => {
    if (aiConfig.chatMode !== "socratic") {
      setState((prev) => ({
        ...prev,
        shouldShowPreheatingUI: false,
        manager: null,
      }));
      return;
    }

    const config: SocraticConfig = {
      book: book || null,
      currentChapter: semanticContext?.currentChapter || "",
      userProfile: socraticSettings.userProfile,
      mode: socraticSettings.mode,
      knowledgeScope: socraticSettings.knowledgeScope,
      language: book?.meta.language || "zh-CN",
      customPrompt: aiConfig.customPrompt,
      enableWebSearch: socraticSettings.enableWebSearch,
    };

    const manager = new SocraticDialogueManager(config, (newPhase) => {
      setState((prev) => ({ ...prev, phase: newPhase }));
      onPhaseChange?.(newPhase);
    });

    sessionCountRef.current += 1;

    const shouldAutoStart =
      socraticSettings.preheatingStrategy === "auto" ||
      (socraticSettings.preheatingStrategy === "smart" && sessionCountRef.current === 1);

    setState({
      phase: manager.getState().phase,
      manager,
      isPreheatingComplete: manager.isPreheatingComplete(),
      shouldShowPreheatingUI: socraticSettings.enablePreheating && shouldAutoStart,
      lastCommand: null,
    });
  }, [
    aiConfig.chatMode,
    aiConfig.customPrompt,
    socraticSettings,
    book,
    semanticContext,
    onPhaseChange,
  ]);

  const processCommand = useCallback(
    (input: string): CommandResult | null => {
      if (!isCommand(input)) {
        return null;
      }

      const parsed = parseCommand(input);
      if (!parsed) {
        return null;
      }

      const { manager } = state;
      if (!manager) {
        return null;
      }

      let result: CommandResult = { success: false };

      switch (parsed.type) {
        case "skip":
          if (isPreheatingCommand(input)) {
            manager.skipPreheating();
            result = {
              success: true,
              message: "已跳过预热阶段，直接进入精读模式",
            };
          }
          break;

        case "start_reading":
          if (isPreheatingCommand(input)) {
            manager.startReading();
            result = {
              success: true,
              message: "正在进入精读模式...",
            };
          }
          break;

        case "end_chapter":
          if (isReadingCommand(input)) {
            manager.startReview();
            result = {
              success: true,
              message: "进入章末回顾模式",
            };
          }
          break;

        case "help":
          result = {
            success: true,
            data: {
              commands: [
                { cmd: "/跳过", desc: "跳过当前预热问题" },
                { cmd: "/开始阅读", desc: "从预热切换到精读模式" },
                { cmd: "/本章结束", desc: "进入章末回顾模式" },
                { cmd: "/总结", desc: "生成当前对话摘要" },
                { cmd: "/重试", desc: "换个方式重新提问" },
                { cmd: "/换个话题", desc: "从新角度提问" },
                { cmd: "/重读", desc: "引用并分析当前章节原文" },
              ],
            },
          };
          break;

        default:
          result = {
            success: false,
            message: "未知命令",
          };
      }

      setState((prev) => ({
        ...prev,
        lastCommand: parsed,
        isPreheatingComplete: manager.isPreheatingComplete(),
        phase: manager.getState().phase,
      }));

      onCommandExecuted?.(parsed, result);
      return result;
    },
    [state, onCommandExecuted],
  );

  const addUserAnswer = useCallback(
    (answer: string) => {
      const { manager } = state;
      if (!manager) return;

      manager.addUserAnswer(answer);

      const currentPhase = manager.getState().phase;
      if (currentPhase === "opening") {
        manager.transitionTo("connection");
      } else if (currentPhase === "connection") {
        manager.transitionTo("connection");
      }

      setState((prev) => ({
        ...prev,
        phase: manager.getState().phase,
        isPreheatingComplete: manager.isPreheatingComplete(),
      }));
    },
    [state],
  );

  const startPreheating = useCallback(() => {
    const { manager } = state;
    if (!manager) return;

    setState((prev) => ({
      ...prev,
      shouldShowPreheatingUI: true,
    }));
  }, [state]);

  const skipPreheating = useCallback(() => {
    const { manager } = state;
    if (!manager) return;

    manager.skipPreheating();
    setState((prev) => ({
      ...prev,
      shouldShowPreheatingUI: false,
      isPreheatingComplete: true,
      phase: manager.getState().phase,
    }));
  }, [state]);

  const transitionToReading = useCallback(() => {
    const { manager } = state;
    if (!manager) return;

    manager.startReading();
    setState((prev) => ({
      ...prev,
      phase: manager.getState().phase,
      isPreheatingComplete: manager.isPreheatingComplete(),
    }));
  }, [state]);

  const transitionToReview = useCallback(() => {
    const { manager } = state;
    if (!manager) return;

    manager.startReview();
    setState((prev) => ({
      ...prev,
      phase: manager.getState().phase,
    }));
  }, [state]);

  const getPreheatingSummary = useCallback(() => {
    const { manager } = state;
    if (!manager) return "";

    return manager.getPreheatingSummary();
  }, [state]);

  const getSystemPrompt = useCallback(() => {
    const { manager } = state;
    if (!manager) return "";

    return manager.getSystemPrompt();
  }, [state]);

  return {
    ...state,
    processCommand,
    addUserAnswer,
    startPreheating,
    skipPreheating,
    transitionToReading,
    transitionToReview,
    getPreheatingSummary,
    getSystemPrompt,
    socraticSettings,
  };
}

export type { PreheatingPhase } from "./socratic-prompt";
