/**
 * Conversation Export Service — 对话精华导出服务
 *
 * 功能：
 * - 预定义多个导出模板（模板化）
 * - AI 分析对话历史，智能提取精华（AI整理）
 * - 支持多种导出格式（Markdown、纯文本、JSON）
 */

import { useSettingsStore } from "@/stores/settings-store";

export type ExportFormat = "markdown" | "plaintext" | "json";
export type ExportTemplateType =
  | "full"
  | "summary"
  | "key_insights"
  | "questions_answers"
  | "chapter_notes";

export interface ExportTemplate {
  id: string;
  name: string;
  description: string;
  type: ExportTemplateType;
  includeStats: boolean;
  sections: ExportSection[];
}

export interface ExportSection {
  key: string;
  label: string;
  enabled: boolean;
}

export interface ConversationExportOptions {
  template: ExportTemplateType;
  format: ExportFormat;
  includeMetadata: boolean;
  useAIEnhancement: boolean;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  metadata?: {
    model?: string;
    tokens?: number;
  };
}

export interface ConversationExportResult {
  content: string;
  format: ExportFormat;
  filename: string;
  mimeType: string;
}

const DEFAULT_TEMPLATES: ExportTemplate[] = [
  {
    id: "full",
    name: "完整对话",
    description: "导出完整对话内容，包括所有问答",
    type: "full",
    includeStats: true,
    sections: [
      { key: "metadata", label: "元信息", enabled: true },
      { key: "messages", label: "对话内容", enabled: true },
      { key: "stats", label: "统计信息", enabled: true },
    ],
  },
  {
    id: "summary",
    name: "对话摘要",
    description: "AI 整理的对话核心内容摘要",
    type: "summary",
    includeStats: false,
    sections: [
      { key: "summary", label: "摘要", enabled: true },
      { key: "key_points", label: "关键要点", enabled: true },
    ],
  },
  {
    id: "key_insights",
    name: "核心洞察",
    description: "提取对话中最重要的观点和洞察",
    type: "key_insights",
    includeStats: false,
    sections: [
      { key: "insights", label: "洞察", enabled: true },
      { key: "quotes", label: "精彩引用", enabled: true },
    ],
  },
  {
    id: "questions_answers",
    name: "问答整理",
    description: "以问答形式整理对话内容",
    type: "questions_answers",
    includeStats: false,
    sections: [{ key: "qa_pairs", label: "问答对", enabled: true }],
  },
  {
    id: "chapter_notes",
    name: "章节笔记",
    description: "针对阅读章节的笔记整理",
    type: "chapter_notes",
    includeStats: false,
    sections: [
      { key: "notes", label: "笔记", enabled: true },
      { key: "questions", label: "思考问题", enabled: true },
      { key: "action_items", label: "行动项", enabled: true },
    ],
  },
];

class ConversationExportService {
  private templates = DEFAULT_TEMPLATES;

  getTemplates(): ExportTemplate[] {
    return this.templates;
  }

  getTemplate(id: string): ExportTemplate | null {
    return this.templates.find((t) => t.id === id) || null;
  }

  async exportConversation(
    messages: ConversationMessage[],
    bookTitle: string,
    chapterTitle: string,
    options: ConversationExportOptions,
  ): Promise<ConversationExportResult> {
    let content: string;

    switch (options.template) {
      case "full":
        content = this.exportFullConversation(messages, bookTitle, chapterTitle, options);
        break;
      case "summary":
        content = options.useAIEnhancement
          ? await this.exportAISummarized(messages, bookTitle, chapterTitle)
          : this.exportSimpleSummary(messages, bookTitle, chapterTitle);
        break;
      case "key_insights":
        content = options.useAIEnhancement
          ? await this.exportAIInsights(messages, bookTitle, chapterTitle)
          : this.exportSimpleInsights(messages, bookTitle, chapterTitle);
        break;
      case "questions_answers":
        content = this.exportQA(messages, bookTitle, chapterTitle);
        break;
      case "chapter_notes":
        content = options.useAIEnhancement
          ? await this.exportAIChapterNotes(messages, bookTitle, chapterTitle)
          : this.exportSimpleChapterNotes(messages, bookTitle, chapterTitle);
        break;
      default:
        content = this.exportFullConversation(messages, bookTitle, chapterTitle, options);
    }

    const format = options.format;
    const filename = this.generateFilename(bookTitle, chapterTitle, format, options.template);

    return {
      content: this.formatContent(content, format),
      format,
      filename,
      mimeType: this.getMimeType(format),
    };
  }

  private exportFullConversation(
    messages: ConversationMessage[],
    bookTitle: string,
    chapterTitle: string,
    options: ConversationExportOptions,
  ): string {
    const lines: string[] = [];

    if (options.includeMetadata) {
      lines.push(`# ${bookTitle}`);
      lines.push(`## ${chapterTitle}`);
      lines.push("");
      lines.push(`导出时间：${new Date().toLocaleString()}`);
      lines.push(`对话数量：${messages.length}`);
      lines.push("");
    }

    lines.push("## 对话内容");
    lines.push("");

    messages.forEach((msg, index) => {
      const role = msg.role === "user" ? "用户" : msg.role === "assistant" ? "AI" : "系统";
      const time = new Date(msg.timestamp).toLocaleTimeString();
      lines.push(`### ${index + 1}. ${role} (${time})`);
      lines.push("");
      lines.push(msg.content);
      lines.push("");
    });

    return lines.join("\n");
  }

  private exportSimpleSummary(
    messages: ConversationMessage[],
    bookTitle: string,
    chapterTitle: string,
  ): string {
    const userMessages = messages.filter((m) => m.role === "user");
    const assistantMessages = messages.filter((m) => m.role === "assistant");

    const lines: string[] = [];
    lines.push(`# ${bookTitle} - ${chapterTitle}`);
    lines.push("");
    lines.push("## 对话摘要");
    lines.push("");
    lines.push(`本次对话共 ${userMessages.length} 轮问答。`);
    lines.push("");
    lines.push("### 主要讨论内容");
    userMessages.forEach((msg, i) => {
      lines.push(`${i + 1}. ${msg.content.slice(0, 100)}${msg.content.length > 100 ? "..." : ""}`);
    });
    lines.push("");
    lines.push("### AI 回应要点");
    assistantMessages.forEach((msg, i) => {
      const preview = msg.content.slice(0, 150).replace(/\n/g, " ");
      lines.push(`${i + 1}. ${preview}${msg.content.length > 150 ? "..." : ""}`);
    });

    return lines.join("\n");
  }

  private exportSimpleInsights(
    messages: ConversationMessage[],
    bookTitle: string,
    chapterTitle: string,
  ): string {
    const assistantMessages = messages.filter((m) => m.role === "assistant");

    const lines: string[] = [];
    lines.push(`# ${bookTitle} - ${chapterTitle}`);
    lines.push("");
    lines.push("## 核心洞察");
    lines.push("");

    assistantMessages.forEach((msg, i) => {
      const preview = msg.content.slice(0, 300);
      if (preview) {
        lines.push(`### 洞察 ${i + 1}`);
        lines.push("");
        lines.push(preview);
        lines.push("");
      }
    });

    return lines.join("\n");
  }

  private exportQA(
    messages: ConversationMessage[],
    bookTitle: string,
    chapterTitle: string,
  ): string {
    const userMessages = messages.filter((m) => m.role === "user");
    const assistantMessages = messages.filter((m) => m.role === "assistant");

    const lines: string[] = [];
    lines.push(`# ${bookTitle} - ${chapterTitle}`);
    lines.push("");
    lines.push("## 问答整理");
    lines.push("");

    const pairCount = Math.min(userMessages.length, assistantMessages.length);

    for (let i = 0; i < pairCount; i++) {
      lines.push(`### Q${i + 1}`);
      lines.push("");
      lines.push(userMessages[i].content);
      lines.push("");
      lines.push(`**A${i + 1}**`);
      lines.push("");
      lines.push(assistantMessages[i].content);
      lines.push("");
    }

    return lines.join("\n");
  }

  private exportSimpleChapterNotes(
    messages: ConversationMessage[],
    bookTitle: string,
    chapterTitle: string,
  ): string {
    const lines: string[] = [];
    lines.push(`# ${bookTitle} - ${chapterTitle}`);
    lines.push("");
    lines.push("## 章节笔记");
    lines.push("");

    const userMessages = messages.filter((m) => m.role === "user");
    const assistantMessages = messages.filter((m) => m.role === "assistant");

    lines.push("### 我的思考");
    userMessages.forEach((msg) => {
      lines.push(`- ${msg.content}`);
    });
    lines.push("");

    lines.push("### 重要收获");
    assistantMessages.forEach((msg) => {
      const points = msg.content.split(/[.!?]/).filter((s) => s.trim().length > 20);
      points.forEach((point) => {
        lines.push(`- ${point.trim()}`);
      });
    });

    return lines.join("\n");
  }

  private async exportAISummarized(
    messages: ConversationMessage[],
    bookTitle: string,
    chapterTitle: string,
  ): Promise<string> {
    const summary = await this.getAISummary(messages);
    const keyPoints = await this.getAIKeyPoints(messages);

    const lines: string[] = [];
    lines.push(`# ${bookTitle} - ${chapterTitle}`);
    lines.push("");
    lines.push("## AI 整理摘要");
    lines.push("");
    lines.push(summary);
    lines.push("");
    lines.push("## 关键要点");
    lines.push("");
    keyPoints.forEach((point, i) => {
      lines.push(`${i + 1}. ${point}`);
    });

    return lines.join("\n");
  }

  private async exportAIInsights(
    messages: ConversationMessage[],
    bookTitle: string,
    chapterTitle: string,
  ): Promise<string> {
    const insights = await this.getAIInsights(messages);
    const quotes = await this.getAIQuotes(messages);

    const lines: string[] = [];
    lines.push(`# ${bookTitle} - ${chapterTitle}`);
    lines.push("");
    lines.push("## 核心洞察");
    lines.push("");
    insights.forEach((insight, i) => {
      lines.push(`### ${i + 1}. ${insight.title}`);
      lines.push("");
      lines.push(insight.description);
      lines.push("");
    });
    lines.push("");
    lines.push("## 精彩引用");
    lines.push("");
    quotes.forEach((quote) => {
      lines.push(`> ${quote}`);
      lines.push("");
    });

    return lines.join("\n");
  }

  private async exportAIChapterNotes(
    messages: ConversationMessage[],
    bookTitle: string,
    chapterTitle: string,
  ): Promise<string> {
    const notes = await this.getAIChapterNotes(messages);
    const questions = await this.getAIQuestions(messages);
    const actionItems = await this.getAIActionItems(messages);

    const lines: string[] = [];
    lines.push(`# ${bookTitle} - ${chapterTitle}`);
    lines.push("");
    lines.push("## 智能笔记");
    lines.push("");
    lines.push(notes);
    lines.push("");
    lines.push("## 思考问题");
    lines.push("");
    questions.forEach((q, i) => {
      lines.push(`${i + 1}. ${q}`);
    });
    lines.push("");
    lines.push("## 行动项");
    lines.push("");
    actionItems.forEach((item) => {
      lines.push(`- [ ] ${item}`);
    });

    return lines.join("\n");
  }

  private async getAISummary(messages: ConversationMessage[]): Promise<string> {
    const content = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
    const prompt = `请总结以下对话的要点，生成一段简洁的摘要（200字以内）：\n\n${content.slice(0, 2000)}`;
    const result = await this.callAI(prompt);
    return result ?? "（AI 摘要生成失败）";
  }

  private async getAIKeyPoints(messages: ConversationMessage[]): Promise<string[]> {
    const content = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
    const prompt = `从以下对话中提取5个关键要点，用 JSON 数组格式返回：\n\n${content.slice(0, 2000)}`;
    const result = await this.callAI(prompt);
    try {
      return result ? JSON.parse(result) : [];
    } catch {
      return ["（AI 要点提取失败）"];
    }
  }

  private async getAIInsights(
    messages: ConversationMessage[],
  ): Promise<Array<{ title: string; description: string }>> {
    const content = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
    const prompt = `从以下对话中提取3个核心洞察，每个洞察包含标题和描述，用 JSON 数组格式返回：\n\n${content.slice(0, 2000)}`;
    const result = await this.callAI(prompt);
    try {
      return result ? JSON.parse(result) : [];
    } catch {
      return [{ title: "（AI 洞察提取失败）", description: "" }];
    }
  }

  private async getAIQuotes(messages: ConversationMessage[]): Promise<string[]> {
    const assistantMessages = messages.filter((m) => m.role === "assistant");
    const content = assistantMessages.map((m) => m.content).join("\n");
    const prompt = `从以下文本中提取3句最精彩的引用，用 JSON 数组格式返回：\n\n${content.slice(0, 2000)}`;
    const result = await this.callAI(prompt);
    try {
      return result ? JSON.parse(result) : [];
    } catch {
      return [];
    }
  }

  private async getAIChapterNotes(messages: ConversationMessage[]): Promise<string> {
    const content = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
    const prompt = `根据以下对话，生成一段章节笔记（300字以内）：\n\n${content.slice(0, 2000)}`;
    const result = await this.callAI(prompt);
    return result ?? "（AI 笔记生成失败）";
  }

  private async getAIQuestions(messages: ConversationMessage[]): Promise<string[]> {
    const content = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
    const prompt = `根据以下对话，提出3个值得进一步思考的问题，用 JSON 数组格式返回：\n\n${content.slice(0, 2000)}`;
    const result = await this.callAI(prompt);
    try {
      return result ? JSON.parse(result) : [];
    } catch {
      return [];
    }
  }

  private async getAIActionItems(messages: ConversationMessage[]): Promise<string[]> {
    const content = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
    const prompt = `根据以下对话，提出3个可以立即执行的行动项，用 JSON 数组格式返回：\n\n${content.slice(0, 2000)}`;
    const result = await this.callAI(prompt);
    try {
      return result ? JSON.parse(result) : [];
    } catch {
      return [];
    }
  }

  private async callAI(prompt: string): Promise<string | null> {
    try {
      const aiConfig = useSettingsStore.getState().aiConfig;
      const endpoint = aiConfig.endpoints.find((ep) => ep.id === aiConfig.activeEndpointId);

      if (!endpoint || !aiConfig.activeModel) {
        return null;
      }

      const requestBody = {
        model: aiConfig.activeModel,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.5,
        max_tokens: 1000,
      };

      const requestUrl = endpoint.baseUrl.endsWith("/")
        ? `${endpoint.baseUrl}chat/completions`
        : `${endpoint.baseUrl}/chat/completions`;

      const response = await fetch(requestUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}),
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content || null;
    } catch {
      return null;
    }
  }

  private formatContent(content: string, format: ExportFormat): string {
    switch (format) {
      case "markdown":
        return content;
      case "plaintext":
        return content
          .replace(/^#+\s*/gm, "")
          .replace(/\*\*(.*?)\*\*/g, "$1")
          .replace(/\[(.*?)\]\(.*?\)/g, "$1")
          .replace(/>\s*/gm, "")
          .trim();
      case "json":
        return JSON.stringify({ content, exportedAt: Date.now() }, null, 2);
      default:
        return content;
    }
  }

  private generateFilename(
    bookTitle: string,
    chapterTitle: string,
    format: ExportFormat,
    templateType: ExportTemplateType,
  ): string {
    const sanitizedBook = bookTitle.replace(/[<>:"/\\|?*]/g, "").slice(0, 30);
    const sanitizedChapter = chapterTitle.replace(/[<>:"/\\|?*]/g, "").slice(0, 20);
    const timestamp = new Date().toISOString().slice(0, 10);
    const ext = format === "json" ? "json" : format === "plaintext" ? "txt" : "md";

    return `${sanitizedBook}_${sanitizedChapter}_${templateType}_${timestamp}.${ext}`;
  }

  private getMimeType(format: ExportFormat): string {
    switch (format) {
      case "markdown":
        return "text/markdown";
      case "plaintext":
        return "text/plain";
      case "json":
        return "application/json";
      default:
        return "text/plain";
    }
  }
}

export const conversationExportService = new ConversationExportService();
