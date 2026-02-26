# ReadAny 阅读器重构计划

## 1. 现状分析

### 1.1 当前架构问题

#### 渲染层问题
- **多渲染器并存**: EPUB/MOBI/CBZ/PDF 分别使用不同渲染器，代码重复
- **PDF 支持不完善**: 通过 foliate-js fixed-layout 渲染 PDF，存在兼容性问题
- **事件处理不统一**: 键盘/滚轮/触摸事件在各渲染器中实现不一致
- **进度追踪混乱**: 不同格式使用不同的位置表示（CFI、pageIndex、chapterIndex）

#### 数据流问题
- **BookDoc 类型混乱**: 有时传 File，有时传 BookDoc，类型不安全
- **预解析逻辑分散**: preParseBook 和 loadBookFile 职责不清
- **缓存策略缺失**: 没有统一的书籍内容缓存机制

#### UI 层问题
- **加载状态管理混乱**: isLoading 在多个地方设置，容易死锁
- **错误处理不完善**: 渲染器错误没有统一捕获和展示
- **主题切换不统一**: EPUB 和 PDF 使用不同的主题系统

### 1.2 Readest 优秀实践

#### 架构设计
- **统一 DocumentLoader**: 所有格式通过 DocumentLoader 预处理为 BookDoc
- **统一 FoliateViewer**: 单组件处理所有格式，通过配置区分行为
- **统一事件系统**: 键盘/滚轮/触摸事件在 Viewer 层统一处理
- **Hooks 化**: 使用 React Hooks 拆分逻辑（useFoliateEvents、usePagination 等）

#### 代码组织
```
app/reader/
├── components/
│   ├── FoliateViewer.tsx      # 核心阅读器组件
│   ├── ReaderContent.tsx      # 阅读器内容包装
│   └── ...
├── hooks/
│   ├── useFoliateEvents.ts    # foliate 事件处理
│   ├── usePagination.ts       # 分页逻辑
│   ├── useKeyboard.ts         # 键盘事件
│   └── ...
├── utils/
│   ├── iframeEventHandlers.ts # iframe 事件处理
│   └── style.ts               # 样式工具
└── page.tsx                   # 阅读器页面

libs/
└── document.ts                # DocumentLoader 和 BookDoc 类型
```

## 2. 重构目标

### 2.1 核心目标
1. **统一渲染层**: 所有格式通过 foliate-js 统一渲染
2. **统一数据流**: 严格的 BookDoc -> View -> Render 数据流
3. **统一事件系统**: 键盘/滚轮/触摸事件在阅读器层统一处理
4. **类型安全**: 完整的 TypeScript 类型定义

### 2.2 性能目标
1. **懒加载**: 书籍内容按需加载，非活跃标签页不占用内存
2. **虚拟滚动**: 长书籍使用虚拟滚动优化性能
3. **缓存策略**: 合理缓存解析后的 BookDoc 和渲染状态

## 3. 重构方案

### 3.1 架构重构

#### 3.1.1 统一渲染架构

```typescript
// 核心类型定义 (libs/document.ts)
export interface BookDoc {
  metadata: BookMetadata;
  rendition?: {
    layout: 'pre-paginated' | 'reflowable';
    spread?: 'auto' | 'none' | 'both';
    viewport?: { width: number; height: number };
  };
  dir: 'ltr' | 'rtl';
  toc?: TOCItem[];
  sections: Section[];
  getCover(): Promise<Blob | null>;
  splitTOCHref(href: string): [string, string | number];
}

export interface Section {
  id: string;
  load(): Promise<string>;  // 返回 blob URL
  unload(): void;
  size: number;
  linear: 'yes' | 'no';
  pageSpread?: 'left' | 'right' | 'center';
}

// 统一文档加载器
export class DocumentLoader {
  constructor(private file: File) {}
  
  async open(): Promise<{ book: BookDoc; format: BookFormat }> {
    // 检测格式并调用对应的 makeBook 函数
    // EPUB -> new EPUB(loader).init()
    // PDF -> makePDF(file)
    // MOBI -> new MOBI().open(file)
    // ...
  }
}
```

#### 3.1.2 统一渲染器组件

```typescript
// components/FoliateViewer.tsx
interface FoliateViewerProps {
  bookDoc: BookDoc;
  config: BookConfig;  // 阅读配置（字体、主题、布局等）
  onLocationChange: (location: Location, progress: number) => void;
  onLoad: (info: LoadInfo) => void;
  onError: (error: Error) => void;
}

export const FoliateViewer: React.FC<FoliateViewerProps> = ({
  bookDoc,
  config,
  onLocationChange,
  onLoad,
  onError,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoliateView | null>(null);
  
  // 使用 hooks 拆分逻辑
  const { handleKeyDown } = useKeyboard(viewRef);
  const { handleWheel } = useWheel(viewRef);
  const { handleTouch } = useTouch(viewRef);
  
  useEffect(() => {
    // 初始化 foliate-view
    const view = document.createElement('foliate-view') as FoliateView;
    view.open(bookDoc).then(() => {
      view.init({ lastLocation: config.lastLocation });
    });
    
    // 绑定事件
    view.addEventListener('relocate', handleRelocate);
    view.addEventListener('load', handleLoad);
    
    containerRef.current?.appendChild(view);
    viewRef.current = view;
    
    return () => {
      view.destroy();
      view.remove();
    };
  }, [bookDoc]);
  
  // 应用配置变化
  useEffect(() => {
    if (!viewRef.current) return;
    
    const renderer = viewRef.current.renderer;
    renderer.setStyles(getStyles(config));
    renderer.setAttribute('theme', config.theme);
    renderer.setAttribute('flow', config.flow);
    // ...
  }, [config]);
  
  return (
    <div 
      ref={containerRef}
      onKeyDown={handleKeyDown}
      onWheel={handleWheel}
      tabIndex={0}
    />
  );
};
```

### 3.2 数据流重构

#### 3.2.1 严格的数据流

```
File (磁盘) 
  -> DocumentLoader.open() 
  -> BookDoc (内存)
    -> FoliateViewer (组件)
      -> foliate-view (web component)
        -> Renderer (paginator/fixed-layout)
```

#### 3.2.2 状态管理

```typescript
// store/readerStore.ts
interface ReaderState {
  // 当前书籍
  currentBook: Book | null;
  bookDoc: BookDoc | null;
  
  // 阅读配置
  config: BookConfig;
  
  // 阅读状态
  location: Location | null;
  progress: number;
  isLoading: boolean;
  error: Error | null;
  
  // 动作
  loadBook: (book: Book) => Promise<void>;
  setLocation: (location: Location) => void;
  updateConfig: (config: Partial<BookConfig>) => void;
}

// 使用 Zustand 或类似状态管理
export const useReaderStore = create<ReaderState>((set, get) => ({
  currentBook: null,
  bookDoc: null,
  // ...
  
  loadBook: async (book) => {
    set({ isLoading: true, error: null });
    
    try {
      const file = await fetchBookFile(book.filePath);
      const loader = new DocumentLoader(file);
      const { bookDoc, format } = await loader.open();
      
      set({ 
        currentBook: book,
        bookDoc,
        isLoading: false 
      });
    } catch (error) {
      set({ error, isLoading: false });
    }
  },
}));
```

### 3.3 事件系统重构

#### 3.3.1 统一事件处理

```typescript
// hooks/useKeyboard.ts
export const useKeyboard = (viewRef: RefObject<FoliateView>) => {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const view = viewRef.current;
    if (!view) return;
    
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        view.prev();
        break;
      case 'ArrowRight':
      case 'ArrowDown':
      case ' ':
        e.preventDefault();
        view.next();
        break;
      case 'Home':
        e.preventDefault();
        view.goTo(0);
        break;
      case 'End':
        e.preventDefault();
        view.goTo(view.book.sections.length - 1);
        break;
    }
  }, [viewRef]);
  
  return { handleKeyDown };
};

// hooks/useWheel.ts
export const useWheel = (viewRef: RefObject<FoliateView>) => {
  const wheelCooldown = useRef(false);
  
  const handleWheel = useCallback((e: WheelEvent) => {
    const view = viewRef.current;
    if (!view || wheelCooldown.current) return;
    
    wheelCooldown.current = true;
    setTimeout(() => { wheelCooldown.current = false; }, 300);
    
    if (e.deltaY > 0) {
      view.next();
    } else if (e.deltaY < 0) {
      view.prev();
    }
  }, [viewRef]);
  
  return { handleWheel };
};
```

### 3.4 样式系统重构

#### 3.4.1 统一主题系统

```typescript
// utils/style.ts
export interface ThemeConfig {
  mode: 'light' | 'dark' | 'sepia';
  backgroundColor: string;
  textColor: string;
  linkColor: string;
}

export const getStyles = (config: BookConfig): Record<string, string> => {
  const theme = getTheme(config.theme);
  
  return {
    'html, body': `
      background-color: ${theme.backgroundColor} !important;
      color: ${theme.textColor} !important;
      font-size: ${config.fontSize}px !important;
      line-height: ${config.lineHeight} !important;
    `,
    'a': `
      color: ${theme.linkColor} !important;
    `,
    // ...
  };
};

// 应用样式到 foliate-view
export const applyStyles = (
  renderer: FoliateRenderer, 
  styles: Record<string, string>
) => {
  renderer.setStyles(styles);
};
```

## 4. 实施计划

### 4.1 第一阶段：基础重构（1-2 周）

#### Week 1: 类型系统和 DocumentLoader
- [ ] 定义完整的 BookDoc、Section、Metadata 类型
- [ ] 实现 DocumentLoader 类
- [ ] 集成 foliate-js 的 makeBook/makePDF/makeFB2 等
- [ ] 编写单元测试

#### Week 2: 核心组件重构
- [ ] 创建新的 FoliateViewer 组件
- [ ] 实现 useKeyboard、useWheel、useTouch hooks
- [ ] 重构 ReaderView 使用新组件
- [ ] 移除旧的 EPUBRenderer/PDFRenderer

### 4.2 第二阶段：功能完善（1-2 周）

#### Week 3: 状态管理和配置
- [ ] 实现 readerStore
- [ ] 统一配置系统（字体、主题、布局）
- [ ] 实现阅读进度保存/恢复
- [ ] 添加错误边界处理

#### Week 4: 性能优化
- [ ] 实现 BookDoc 缓存
- [ ] 懒加载非活跃标签页
- [ ] 虚拟滚动（如果需要）
- [ ] 内存泄漏检查

### 4.3 第三阶段：测试和优化（1 周）

- [ ] 端到端测试（EPUB、PDF、MOBI）
- [ ] 性能测试（大文件、多标签）
- [ ] 用户体验测试
- [ ] 文档更新

## 5. 技术细节

### 5.1 PDF 支持方案

参考 Readest，使用 foliate-js/pdf.js：

```typescript
// libs/document.ts - makePDF 集成
import { makePDF } from 'foliate-js/pdf.js';

async function loadPDF(file: File): Promise<BookDoc> {
  // 使用 foliate-js 提供的 PDF 适配器
  const book = await makePDF(file);
  
  // 转换为统一的 BookDoc 格式
  return {
    metadata: {
      title: book.metadata.title,
      author: book.metadata.author,
      // ...
    },
    rendition: {
      layout: 'pre-paginated',
      spread: 'auto',
    },
    sections: book.sections,
    // ...
  };
}
```

### 5.2 事件系统细节

```typescript
// 事件处理优先级
// 1. 用户输入（键盘/滚轮/触摸）-> 阅读器组件处理
// 2. 书籍事件（章节加载、位置变化）-> foliate-view 处理
// 3. 渲染事件（样式应用、布局变化）-> renderer 处理

// 事件流
User Event 
  -> FoliateViewer (React)
    -> foliate-view (Web Component)
      -> Renderer (Paginator/FixedLayout)
        -> iframe/content
```

### 5.3 样式系统细节

```typescript
// 样式优先级（从高到低）
// 1. 用户自定义 CSS
// 2. 主题样式（dark/light/sepia）
// 3. 阅读设置（字体、字号、行高）
// 4. 书籍自带样式
// 5. 默认样式

// 样式注入流程
const applyStyles = (renderer, config) => {
  const baseStyles = getBaseStyles();
  const bookStyles = getBookStyles();
  const themeStyles = getThemeStyles(config.theme);
  const userStyles = config.customCSS;
  
  renderer.setStyles({
    ...baseStyles,
    ...bookStyles,
    ...themeStyles,
    ...userStyles,
  });
};
```

## 6. 风险和对策

### 6.1 主要风险

1. **foliate-js 稳定性**: foliate-js 仍在开发中，API 可能变化
   - 对策：锁定版本，fork 并维护稳定分支

2. **PDF 渲染性能**: PDF 渲染可能占用大量内存
   - 对策：实现虚拟滚动，只渲染可见页面

3. **大文件处理**: 大 EPUB/PDF 文件可能导致卡顿
   - 对策：分片加载，Web Worker 解析

4. **兼容性**: 不同格式的 edge cases
   - 对策：完善的错误处理和降级策略

### 6.2 回滚方案

如果重构出现问题，可以：
1. 保留旧的渲染器作为 fallback
2. 使用 feature flag 切换新旧实现
3. 逐步灰度发布

## 7. 参考资源

### 7.1 Readest 关键文件
- `apps/readest-app/src/libs/document.ts` - DocumentLoader
- `apps/readest-app/src/app/reader/components/FoliateViewer.tsx` - 核心组件
- `apps/readest-app/src/app/reader/hooks/` - Hooks 集合
- `apps/readest-app/src/app/reader/utils/` - 工具函数

### 7.2 foliate-js 文档
- https://github.com/johnfactotum/foliate-js
- https://github.com/readest/foliate-js (Readest fork)

### 7.3 相关库
- pdf.js: https://github.com/mozilla/pdf.js
- zip.js: https://gildas-lormeau.github.io/zip.js/