/**
 * Feedback system types
 */

export type FeedbackType = "bug" | "feature" | "other";

export interface DeviceInfo {
  platform: "ios" | "android" | "macos" | "windows" | "linux";
  osVersion: string;
  appVersion: string;
  /** Web engine + build rendering the app UI (e.g. "WebView2 152.0.4191.62"). */
  webview?: string;
  deviceModel?: string;
  locale: string;
}

export interface FeedbackSubmission {
  type: FeedbackType;
  title: string;
  description: string;
  includeLogs: boolean;
  deviceInfo: DeviceInfo;
  logs?: string;
}

export interface FeedbackRecord {
  id: string;
  issueNumber: number;
  issueUrl: string;
  title: string;
  type: FeedbackType;
  status: "open" | "closed";
  createdAt: number;
  updatedAt?: number;
  hasNewReply?: boolean;
}

export interface FeedbackSubmitResult {
  issueNumber: number;
  issueUrl: string;
}

export interface FeedbackStatusItem {
  number: number;
  state: "open" | "closed";
  title: string;
  hasNewComment: boolean;
  commentCount?: number;
}

export interface FeedbackComment {
  id: number;
  body: string;
  createdAt: string;
  author: string;
  avatarUrl: string;
}

export interface FeedbackDetail {
  number: number;
  title: string;
  state: "open" | "closed";
  body: string;
  createdAt: string;
  updatedAt: string;
  comments: FeedbackComment[];
}
