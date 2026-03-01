/**
 * AboutSettings — 关于页面
 */
import { useTranslation } from "react-i18next";
import { ExternalLink, Github, BookOpen, Code2, Zap, Shield } from "lucide-react";

const TECH_STACK = [
  { name: "Tauri", desc: "跨平台桌面框架", icon: Shield },
  { name: "React", desc: "UI 组件库", icon: Code2 },
  { name: "TypeScript", desc: "类型安全", icon: Zap },
  { name: "Foliate", desc: "电子书渲染引擎", icon: BookOpen },
];

export function AboutSettings() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center p-6">
      {/* Logo & App Name */}
      <div className="mb-6 flex flex-col items-center">
        <img
          src="/logo.svg"
          alt="ReadAny Logo"
          className="mb-4 h-24 w-24 drop-shadow-lg"
        />
        <h1 className="text-2xl font-bold text-neutral-900">ReadAny</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {t("settings.aboutDesc")}
        </p>
      </div>

      {/* Version Card */}
      <div className="mb-6 w-full max-w-md rounded-xl bg-muted/60 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-neutral-600">{t("settings.version", "版本")}</span>
          <span className="font-mono text-sm font-medium text-neutral-900">1.0.0</span>
        </div>
      </div>

      {/* Tech Stack */}
      <div className="mb-6 w-full max-w-md">
        <h2 className="mb-3 text-sm font-medium text-neutral-900">
          {t("settings.techStack", "技术栈")}
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {TECH_STACK.map(({ name, desc, icon: Icon }) => (
            <div
              key={name}
              className="flex items-center gap-3 rounded-lg bg-muted/60 p-3"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                <Icon className="h-4 w-4 text-primary" />
              </div>
              <div>
                <div className="text-sm font-medium text-neutral-900">{name}</div>
                <div className="text-xs text-neutral-500">{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Links */}
      <div className="w-full max-w-md space-y-2">
        <a
          href="https://github.com/codedogQBY/ReadAny"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between rounded-lg bg-muted/60 p-3 transition-colors hover:bg-muted"
        >
          <div className="flex items-center gap-3">
            <Github className="h-5 w-5 text-neutral-600" />
            <span className="text-sm font-medium text-neutral-900">GitHub</span>
          </div>
          <ExternalLink className="h-4 w-4 text-neutral-400" />
        </a>

        <a
          href="https://github.com/codedogQBY/ReadAny/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between rounded-lg bg-muted/60 p-3 transition-colors hover:bg-muted"
        >
          <div className="flex items-center gap-3">
            <BookOpen className="h-5 w-5 text-neutral-600" />
            <span className="text-sm font-medium text-neutral-900">
              {t("settings.feedback", "反馈问题")}
            </span>
          </div>
          <ExternalLink className="h-4 w-4 text-neutral-400" />
        </a>
      </div>

      {/* Copyright */}
      <div className="mt-8 text-center text-xs text-neutral-400">
        <p>© 2026 codedogQBY. All rights reserved.</p>
        <p className="mt-1">
          {t("settings.license", "基于 MIT 许可证开源")}
        </p>
      </div>
    </div>
  );
}
