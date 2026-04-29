export const languages = {
  en: "English",
  zh: "中文",
};

export const defaultLang = "en";

export const ui = {
  en: {
    "nav.home": "Home",
    "nav.features": "Features",
    "nav.download": "Download",
    "nav.docs": "Docs",
    "nav.community": "Community",
    "nav.support": "Support",
    "nav.github": "GitHub",
    "hero.title": "Read Any, Understand More",
    "hero.subtitle":
      "An AI-powered e-book reader with intelligent chat, semantic search, annotation, and knowledge management.",
    "hero.download": "Download",
    "hero.learn": "Learn More",
    "hero.platforms": "Available on all platforms",
    "hero.screenshot": "Screenshot Coming Soon",
    "hero.stats.formats": "Formats",
    "hero.stats.providers": "AI Providers",
    "hero.stats.local": "Local First",
    "hero.stats.opensource": "Open Source",
    "features.title": "Features",
    "features.subtitle": "Everything you need for smarter reading",
    "features.ai.title": "AI Chat Assistant",
    "features.ai.desc":
      "Ask questions about your books with context-aware responses. The AI knows your current position, selected text, and chapter info.",
    "features.search.title": "Semantic Search",
    "features.search.desc":
      "Go beyond keyword search. Find passages by meaning with hybrid retrieval combining vector similarity and BM25.",
    "features.formats.title": "Multi-Format Support",
    "features.formats.desc":
      "Read EPUB, PDF, MOBI, AZW, AZW3, FB2, FBZ, CBZ - all your favorite e-book formats in one app.",
    "features.notes.title": "Smart Annotations",
    "features.notes.desc":
      "Highlight in 5 colors, take Markdown notes, and export to Obsidian, Notion, or plain Markdown.",
    "features.providers.title": "Multiple AI Providers",
    "features.providers.desc":
      "OpenAI, Anthropic Claude, Google Gemini, Ollama, DeepSeek - use your preferred AI service.",
    "features.stats.title": "Reading Statistics",
    "features.stats.desc":
      "Track your reading time, progress, and habits with detailed statistics and visualizations.",
    "download.title": "Download",
    "download.subtitle": "Get started with ReadAny on your platform",
    "download.mac": "macOS",
    "download.mac.arm": "macOS (Apple Silicon)",
    "download.mac.intel": "macOS (Intel)",
    "download.windows": "Windows",
    "download.linux": "Linux",
    "download.ios": "iOS",
    "download.android": "Android",
    "download.all": "View all releases",
    "download.opensource":
      "The source code is completely open-source and free. App store versions may have a small fee to support ongoing development and certificate costs. You can always build from source for free.",
    "community.title": "Community & Support",
    "community.subtitle": "Join the conversation and get help",
    "community.join": "Join Our Community",
    "community.discussions": "GitHub Discussions",
    "community.issues": "GitHub Issues",
    "community.xiaohongshu": "小红书群",
    "community.wechat": "微信群",
    "community.coming": "Coming soon",
    "community.sponsor.title": "☕ Support the Project",
    "community.sponsor.subtitle": "If you find ReadAny helpful, consider buying me a coffee!",
    "community.sponsor.wechat": "WeChat",
    "community.sponsor.alipay": "Alipay",
    "footer.github": "Star on GitHub",
    "footer.copyright": "© 2025 ReadAny. GPL-3.0 License.",

    "howItWorks.title": "How It Works",
    "howItWorks.subtitle": "From import to intelligent reading in four simple steps",
    "howItWorks.step1.title": "Import Your Books",
    "howItWorks.step1.desc":
      "Drag and drop your e-books or import from cloud storage. Support for EPUB, PDF, MOBI, and more.",
    "howItWorks.step2.title": "Start Reading",
    "howItWorks.step2.desc":
      "Enjoy a distraction-free reading experience with customizable themes, fonts, and layouts.",
    "howItWorks.step3.title": "Chat with AI",
    "howItWorks.step3.desc":
      "Ask questions about your book content. AI understands context and provides intelligent answers.",
    "howItWorks.step4.title": "Organize Knowledge",
    "howItWorks.step4.desc":
      "Highlight passages, take notes, and export to your favorite tools like Obsidian or Notion.",

    "useCases.title": "Perfect For Every Reader",
    "useCases.subtitle":
      "Whether you're a student, researcher, or casual reader, ReadAny adapts to your needs.",
    "useCases.research.title": "Academic Research",
    "useCases.research.desc":
      "Researchers can quickly analyze papers, extract key insights, and organize references with AI-powered annotations and semantic search.",
    "useCases.research.f1": "PDF annotation",
    "useCases.research.f2": "Citation management",
    "useCases.research.f3": "Knowledge graphs",
    "useCases.language.title": "Language Learning",
    "useCases.language.desc":
      "Language learners can translate passages, get explanations, and practice with AI conversations about book content.",
    "useCases.language.f1": "Instant translation",
    "useCases.language.f2": "Context explanations",
    "useCases.language.f3": "Vocabulary building",
    "useCases.professional.title": "Professional Development",
    "useCases.professional.desc":
      "Professionals can summarize technical books, extract actionable insights, and build a personal knowledge base.",
    "useCases.professional.f1": "Quick summaries",
    "useCases.professional.f2": "Key takeaways",
    "useCases.professional.f3": "Note export",
    "useCases.bookClub.title": "Book Clubs & Discussion",
    "useCases.bookClub.desc":
      "Book club members can prepare discussion points, analyze themes, and share annotated passages with the group.",
    "useCases.bookClub.f1": "Discussion guides",
    "useCases.bookClub.f2": "Theme analysis",
    "useCases.bookClub.f3": "Passage sharing",

    "mobile.title": "Read Anywhere, Anytime",
    "mobile.desc":
      "Take your library with you. ReadAny works seamlessly across all your devices - desktop, tablet, and mobile.",
    "mobile.sync.title": "Sync Across Devices",
    "mobile.sync.desc":
      "Your reading progress, annotations, and settings sync automatically via WebDAV.",
    "mobile.offline.title": "Offline Reading",
    "mobile.offline.desc": "All your books are stored locally. Read without internet connection.",
    "mobile.optimized.title": "Mobile Optimized",
    "mobile.optimized.desc":
      "Touch-friendly interface with gestures for navigation and annotation.",

    "techStack.title": "Built with Modern Technology",
    "techStack.subtitle": "Powered by cutting-edge frameworks and tools for the best performance",

    "faq.title": "Frequently Asked Questions",
    "faq.subtitle": "Everything you need to know about ReadAny",
    "faq.q1": "Is ReadAny free to use?",
    "faq.a1":
      "Yes! ReadAny is completely free and open-source under the GPL-3.0 license. The source code is completely open source and free, but the official app store version may charge a fee to support continuous development and cover certificate costs. You can always compile and use it for free.",
    "faq.q2": "Which AI providers are supported?",
    "faq.a2":
      "ReadAny supports OpenAI, Anthropic Claude, Google Gemini, Ollama, DeepSeek, and any custom OpenAI-compatible API. You can use your own API keys.",
    "faq.q3": "Is my data private?",
    "faq.a3":
      "Absolutely. All your books, annotations, and reading data are stored locally on your device. Nothing is sent to external servers unless you explicitly sync via WebDAV.",
    "faq.q4": "What e-book formats are supported?",
    "faq.a4":
      "ReadAny supports EPUB, PDF, MOBI, AZW, AZW3, FB2, FBZ, CBZ, and more. We're constantly adding support for additional formats.",
    "faq.q5": "Can I sync across devices?",
    "faq.a5":
      "Yes! ReadAny supports WebDAV, S3, and LAN sync, allowing you to sync your library, reading progress, and annotations across all your devices.",
    "faq.q6": "How does the AI chat work?",
    "faq.a6":
      "The AI chat understands your current reading context - your position in the book, selected text, and chapter information. It can answer questions, explain concepts, and help with summaries.",
    "faq.q7": 'macOS says the app "is damaged and can\'t be opened"?',
    "faq.a7":
      'This is caused by macOS Gatekeeper security. To fix it: 1) Go to System Settings → Privacy & Security → Security, and allow apps from "Anywhere". 2) If it still doesn\'t work, drag the app to the Applications folder, then open Terminal and run: <code>sudo xattr -rd com.apple.quarantine /Applications/ReadAny.app</code>',
    "faq.more": "Still have questions?",
    "faq.help": "Visit Help Center",

    "featureShowcase.title": "Powerful Features for Modern Readers",
    "featureShowcase.subtitle": "Everything you need for an enhanced reading experience",
    "featureShowcase.ai.title": "AI-Powered Chat",
    "featureShowcase.ai.desc":
      "Chat with your books using AI. Ask questions, get summaries, explore themes, and translate instantly. Supports OpenAI, Claude, Gemini, Ollama, and DeepSeek.",
    "featureShowcase.annotations.title": "Notes & Highlights",
    "featureShowcase.annotations.desc":
      "Highlight in 5 colors, take Markdown notes, and export to Obsidian, Notion, or plain Markdown. Organize your knowledge effortlessly.",
    "featureShowcase.tts.title": "Text-to-Speech",
    "featureShowcase.tts.desc":
      "Listen to your books with Edge TTS. Choose from 100+ voices in multiple languages, adjust speed, and enjoy background playback.",
    "featureShowcase.stats.title": "Reading Statistics",
    "featureShowcase.stats.desc":
      "Track your reading habits with heatmaps, trend charts, and streak tracking. Visualize your progress like GitHub contributions.",
    "featureShowcase.sync.title": "Cross-Device Sync",
    "featureShowcase.sync.desc":
      "Sync your library, highlights, and notes across all devices. Supports WebDAV, S3, and LAN sync with automatic background synchronization.",
    "featureShowcase.badge.free": "Free & Open Source",
    "featureShowcase.badge.privacy": "Privacy Focused",
  },
  zh: {
    "nav.home": "首页",
    "nav.features": "功能",
    "nav.download": "下载",
    "nav.docs": "文档",
    "nav.community": "社区",
    "nav.support": "帮助中心",
    "nav.github": "GitHub",
    "hero.title": "阅读无界，理解无限",
    "hero.subtitle": "一款 AI 驱动的电子书阅读器，支持智能对话、语义搜索、标注笔记与知识管理。",
    "hero.download": "立即下载",
    "hero.learn": "了解更多",
    "hero.platforms": "支持全平台",
    "hero.screenshot": "截图即将上线",
    "hero.stats.formats": "格式支持",
    "hero.stats.providers": "AI 提供商",
    "hero.stats.local": "本地优先",
    "hero.stats.opensource": "开源",
    "features.title": "功能特性",
    "features.subtitle": "智能阅读所需的一切",
    "features.ai.title": "AI 对话助手",
    "features.ai.desc": "基于书籍内容的智能问答，AI 能感知你当前的阅读位置、选中文本和章节信息。",
    "features.search.title": "语义搜索",
    "features.search.desc": "超越关键词搜索，按语义查找段落，支持向量相似度和 BM25 混合检索。",
    "features.formats.title": "多格式支持",
    "features.formats.desc": "支持 EPUB、PDF、MOBI、AZW、AZW3、FB2、FBZ、CBZ 等主流电子书格式。",
    "features.notes.title": "智能标注",
    "features.notes.desc":
      "5 种颜色高亮、Markdown 笔记，支持导出到 Obsidian、Notion 或纯 Markdown。",
    "features.providers.title": "多 AI 提供商",
    "features.providers.desc":
      "支持 OpenAI、Anthropic Claude、Google Gemini、Ollama、DeepSeek 等多种 AI 服务。",
    "features.stats.title": "阅读统计",
    "features.stats.desc": "追踪阅读时间、进度和习惯，提供详细的统计和可视化。",
    "download.title": "下载 ReadAny",
    "download.subtitle": "支持所有平台",
    "download.opensource":
      "源代码完全开源免费，但官方应用商店版本可能会收取一定费用，用于支持持续开发和覆盖证书成本。你始终可以免费自行编译使用。",
    "download.mac.arm": "macOS (Apple Silicon)",
    "download.mac.intel": "macOS (Intel)",
    "download.windows": "Windows",
    "download.linux": "Linux",
    "download.ios": "iOS",
    "download.android": "Android",
    "download.all": "查看所有版本",
    "community.title": "社区与支持",
    "community.subtitle": "参与讨论，获取帮助",
    "community.join": "加入社群",
    "community.discussions": "GitHub 讨论区",
    "community.issues": "GitHub Issues",
    "community.xiaohongshu": "小红书群",
    "community.wechat": "微信群",
    "community.coming": "即将上线",
    "community.sponsor.title": "☕ 请作者喝杯咖啡",
    "community.sponsor.subtitle": "如果你觉得 ReadAny 对你有帮助，欢迎支持项目的持续开发！",
    "community.sponsor.wechat": "微信赞赏",
    "community.sponsor.alipay": "支付宝",
    "footer.github": "Star on GitHub",
    "footer.copyright": "© 2025 ReadAny. GPL-3.0 许可证。",

    "howItWorks.title": "如何使用",
    "howItWorks.subtitle": "从导入到智能阅读，只需四步",
    "howItWorks.step1.title": "导入书籍",
    "howItWorks.step1.desc": "拖放电子书或从云端导入，支持 EPUB、PDF、MOBI 等多种格式。",
    "howItWorks.step2.title": "开始阅读",
    "howItWorks.step2.desc": "享受无干扰的阅读体验，自定义主题、字体和布局。",
    "howItWorks.step3.title": "AI 对话",
    "howItWorks.step3.desc": "针对书籍内容提问，AI 理解上下文并提供智能回答。",
    "howItWorks.step4.title": "知识管理",
    "howItWorks.step4.desc": "高亮段落、记录笔记，导出到 Obsidian 或 Notion 等工具。",

    "useCases.title": "适合每位读者",
    "useCases.subtitle": "无论你是学生、研究者还是普通读者，ReadAny 都能满足你的需求。",
    "useCases.research.title": "学术研究",
    "useCases.research.desc":
      "研究者可以快速分析论文、提取关键见解，通过 AI 标注和语义搜索组织参考文献。",
    "useCases.research.f1": "PDF 标注",
    "useCases.research.f2": "引文管理",
    "useCases.research.f3": "知识图谱",
    "useCases.language.title": "语言学习",
    "useCases.language.desc": "语言学习者可以翻译段落、获取解释，并与 AI 就书籍内容进行对话练习。",
    "useCases.language.f1": "即时翻译",
    "useCases.language.f2": "语境解释",
    "useCases.language.f3": "词汇构建",
    "useCases.professional.title": "职业发展",
    "useCases.professional.desc": "专业人士可以总结技术书籍、提取可操作的见解，建立个人知识库。",
    "useCases.professional.f1": "快速摘要",
    "useCases.professional.f2": "关键要点",
    "useCases.professional.f3": "笔记导出",
    "useCases.bookClub.title": "读书会与讨论",
    "useCases.bookClub.desc": "读书会成员可以准备讨论要点、分析主题，并与小组分享标注段落。",
    "useCases.bookClub.f1": "讨论指南",
    "useCases.bookClub.f2": "主题分析",
    "useCases.bookClub.f3": "段落分享",

    "mobile.title": "随时随地阅读",
    "mobile.desc": "随身携带你的图书馆。ReadAny 在所有设备上无缝运行 - 桌面、平板和移动端。",
    "mobile.sync.title": "跨设备同步",
    "mobile.sync.desc": "你的阅读进度、标注和设置通过 WebDAV 自动同步。",
    "mobile.offline.title": "离线阅读",
    "mobile.offline.desc": "所有书籍都存储在本地，无需网络连接即可阅读。",
    "mobile.optimized.title": "移动端优化",
    "mobile.optimized.desc": "触摸友好的界面，支持手势导航和标注。",

    "techStack.title": "基于现代技术构建",
    "techStack.subtitle": "由前沿框架和工具驱动，提供最佳性能",

    "faq.title": "常见问题",
    "faq.subtitle": "关于 ReadAny 你需要知道的一切",
    "faq.q1": "ReadAny 免费吗？",
    "faq.a1":
      "是的！ReadAny 完全免费且开源，采用 GPL-3.0 许可证。源代码完全开源免费，但官方应用商店版本可能会收取一定费用，用于支持持续开发和覆盖证书成本。你始终可以免费自行编译使用。",
    "faq.q2": "支持哪些 AI 提供商？",
    "faq.a2":
      "ReadAny 支持 OpenAI、Anthropic Claude、Google Gemini、Ollama、DeepSeek 以及任何自定义的 OpenAI 兼容 API。你可以使用自己的 API 密钥。",
    "faq.q3": "我的数据隐私吗？",
    "faq.a3":
      "绝对隐私。你的所有书籍、标注和阅读数据都存储在本地设备上。除非你明确通过 WebDAV 同步，否则不会发送到外部服务器。",
    "faq.q4": "支持哪些电子书格式？",
    "faq.a4":
      "ReadAny 支持 EPUB、PDF、MOBI、AZW、AZW3、FB2、FBZ、CBZ 等格式。我们正在不断增加对新格式的支持。",
    "faq.q5": "可以跨设备同步吗？",
    "faq.a5":
      "可以！ReadAny 支持 WebDAV、S3 和局域网同步，可以在所有设备间同步你的书库、阅读进度和标注。",
    "faq.q6": "AI 对话如何工作？",
    "faq.a6":
      "AI 对话理解你当前的阅读上下文 - 你在书中的位置、选中的文本和章节信息。它可以回答问题、解释概念并帮助总结。",
    "faq.q7": "macOS 打开软件提示「已损坏，无法打开」怎么办？",
    "faq.a7":
      "这是 macOS 的安全机制导致的。解决方法：1) 前往「系统设置」→「隐私与安全性」→「安全性」，允许从「任何来源」下载的 App。2) 如果仍无法运行，请将应用拖到「应用程序」文件夹，然后打开终端执行：<code>sudo xattr -rd com.apple.quarantine /Applications/ReadAny.app</code>",
    "faq.more": "还有问题？",
    "faq.help": "访问帮助中心",

    "featureShowcase.title": "现代读者的强大功能",
    "featureShowcase.subtitle": "增强阅读体验所需的一切",
    "featureShowcase.ai.title": "AI 智能对话",
    "featureShowcase.ai.desc":
      "与你的书籍对话。提问、获取摘要、探索主题、即时翻译。支持 OpenAI、Claude、Gemini、Ollama 和 DeepSeek。",
    "featureShowcase.annotations.title": "笔记和高亮",
    "featureShowcase.annotations.desc":
      "5 种颜色高亮、Markdown 笔记，一键导出到 Obsidian、Notion 或纯 Markdown。轻松组织你的知识。",
    "featureShowcase.tts.title": "TTS 语音朗读",
    "featureShowcase.tts.desc":
      "使用 Edge TTS 听书。100+ 种多语言声音可选，调节语速，支持后台播放。",
    "featureShowcase.stats.title": "阅读统计",
    "featureShowcase.stats.desc":
      "用热力图、趋势图和连续天数追踪你的阅读习惯。像 GitHub 贡献一样可视化你的进度。",
    "featureShowcase.sync.title": "跨设备同步",
    "featureShowcase.sync.desc":
      "在所有设备间同步书库、高亮和笔记。支持 WebDAV、S3 和局域网同步，自动后台同步。",
    "featureShowcase.badge.free": "免费开源",
    "featureShowcase.badge.privacy": "隐私优先",
  },
} as const;

export type UIKey = keyof typeof ui.en;
