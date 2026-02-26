# 重构架构总览

## 1. 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                         ReadAny App                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Library     │  │   Reader     │  │   Settings   │          │
│  │  (书架页)     │  │   (阅读页)    │  │   (设置页)    │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                 │                  │
│         └─────────────────┼─────────────────┘                  │
│                           │                                     │
│  ┌────────────────────────┴────────────────────────┐           │
│  │              Store Layer (状态管理层)            │           │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐  │           │
│  │  │ bookStore  │ │ readerStore│ │ settingsStore│  │           │
│  │  └────────────┘ └────────────┘ └────────────┘  │           │
│  └────────────────────────┬────────────────────────┘           │
│                           │                                     │
│  ┌────────────────────────┴────────────────────────┐           │
│  │           Document Layer (文档处理层)            │           │
│  │  ┌──────────────────────────────────────────┐  │           │
│  │  │         DocumentLoader                    │  │           │
│  │  │  ┌────────┐ ┌────────┐ ┌────────┐       │  │           │
│  │  │  │  EPUB  │ │  PDF   │ │  MOBI  │       │  │           │
│  │  │  │ Loader │ │ Loader │ │ Loader │       │  │           │
│  │  │  └────┬───┘ └───┬────┘ └───┬────┘       │  │           │
│  │  │       └─────────┴─────────┘              │  │           │
│  │  │                 │                        │  │           │
│  │  │            BookDoc (统一格式)             │  │           │
│  │  └──────────────────────────────────────────┘  │           │
│  └────────────────────────┬────────────────────────┘           │
│                           │                                     │
│  ┌────────────────────────┴────────────────────────┐           │
│  │           Render Layer (渲染层)                 │           │
│  │  ┌──────────────────────────────────────────┐  │           │
│  │  │         FoliateViewer                   │  │           │
│  │  │  ┌──────────────────────────────────┐   │  │           │
│  │  │  │      foliate-view                │   │  │           │
│  │  │  │  ┌──────────┐  ┌──────────┐     │   │  │           │
│  │  │  │  │Paginator │  │FixedLayout│     │   │  │           │
│  │  │  │  │(EPUB/TXT)│  │(PDF/CBZ) │     │   │  │           │
│  │  │  │  └──────────┘  └──────────┘     │   │  │           │
│  │  │  └──────────────────────────────────┘   │  │           │
│  │  └──────────────────────────────────────────┘  │           │
│  └─────────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

## 2. 核心概念对比

### 2.1 当前实现 vs 重构后

| 维度 | 当前实现 | 重构后 (Readest 模式) |
|------|---------|---------------------|
| **格式支持** | 多个渲染器 (EPUBRenderer, PDFRenderer) | 统一 DocumentLoader + FoliateViewer |
| **数据流** | File -> Renderer (各自处理) | File -> DocumentLoader -> BookDoc -> FoliateViewer |
| **事件处理** | 各渲染器自己实现 | 统一在 FoliateViewer 层处理 |
| **状态管理** | 分散在组件中 | 集中在 readerStore |
| **样式系统** | 各渲染器独立 | 统一通过 foliate-js 的 setStyles |

### 2.2 Readest 核心设计哲学

1. **单一职责**: 每个组件/Hook只做一件事
2. **配置驱动**: 通过配置对象控制行为，而非条件判断
3. **事件委托**: 事件在顶层统一处理，通过 ref 传递给底层
4. **懒加载**: 非必要不加载，非活跃不渲染

## 3. 数据流详细设计

### 3.1 书籍加载流程

```
用户点击书籍
    │
    ▼
┌─────────────────┐
│ 1. 检查缓存      │
│    - 内存缓存     │
│    - IndexedDB  │
│    - 磁盘文件    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 2. 加载文件      │
│    - Tauri API  │
│    - 读取为 Blob │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 3. 格式检测      │
│    - 文件头魔法数 │
│    - 扩展名      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 4. 解析书籍      │
│    - DocumentLoader│
│    - 生成 BookDoc │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 5. 渲染书籍      │
│    - FoliateViewer│
│    - foliate-view │
└─────────────────┘
```

### 3.2 阅读进度同步流程

```
用户翻页/滚动
    │
    ▼
┌─────────────────┐
│ 1. 捕获事件      │
│    - 键盘/滚轮   │
│    - 触摸/点击   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 2. 更新位置      │
│    - foliate-view│
│    - dispatch 'relocate'│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 3. 计算进度      │
│    - 当前章节    │
│    - 总章节数    │
│    - 百分比      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 4. 更新状态      │
│    - readerStore │
│    - UI 更新     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 5. 持久化        │
│    - 防抖保存    │
│    - 写入数据库  │
└─────────────────┘
```

## 4. 模块依赖关系

```
app/
├── components/reader/
│   ├── FoliateViewer.tsx      # 依赖: hooks/useKeyboard, hooks/useWheel, utils/style
│   ├── ReaderContent.tsx      # 依赖: FoliateViewer, store/readerStore
│   └── ...
├── hooks/
│   ├── useKeyboard.ts         # 依赖: 无 (纯逻辑)
│   ├── useWheel.ts            # 依赖: 无 (纯逻辑)
│   ├── useFoliateEvents.ts    # 依赖: store/readerStore
│   └── ...
├── utils/
│   ├── style.ts               # 依赖: types/book
│   └── ...
└── store/
    └── readerStore.ts         # 依赖: libs/document

libs/
├── document.ts                # 依赖: foliate-js/*, @zip.js/zip.js
└── ...

types/
└── book.ts                    # 依赖: 无 (基础类型)
```

## 5. 关键技术决策

### 5.1 为什么选择 foliate-js?

**优点:**
- 纯 JavaScript，无需原生依赖
- 支持多种格式 (EPUB, MOBI, FB2, CBZ, PDF)
- 模块化的架构，可以按需引入
- Readest 已经在生产环境验证
- MIT 许可证，可商用

**缺点:**
- 还在快速开发中，API 可能变化
- PDF 支持是实验性的
- 文档不够完善

**替代方案对比:**

| 方案 | 优点 | 缺点 | 许可证 |
|------|------|------|--------|
| foliate-js | 纯 JS，多格式支持 | API 不稳定 | MIT |
| epub.js | 成熟稳定 | 只支持 EPUB | BSD |
| pdf.js | PDF 支持好 | 只支持 PDF | Apache-2.0 |
| kookit | 功能完整 | 非开源，AGPL | AGPL-3.0 |

### 5.2 为什么使用 Web Components (foliate-view)?

**优点:**
- 封装性好，内部状态不污染 React
- 可以使用 Shadow DOM 隔离样式
- 事件系统独立，不经过 React 合成事件

**挑战:**
- React 和 Web Components 的集成需要处理
- ref 转发需要特殊处理
- 类型定义需要额外维护

### 5.3 状态管理选择

**当前:** 多个 useState + useContext

**重构后:** Zustand

**原因:**
- 轻量级，学习成本低
- 支持 TypeScript 类型推断
- 可以脱离 React 使用
- 中间件生态丰富 (persist, subscribe, etc.)

## 6. 性能优化策略

### 6.1 书籍解析优化

```typescript
// 1. 缓存解析结果
const bookCache = new Map<string, BookDoc>();

async function loadBook(filePath: string): Promise<BookDoc> {
  // 检查内存缓存
  if (bookCache.has(filePath)) {
    return bookCache.get(filePath)!;
  }
  
  // 检查 IndexedDB 缓存
  const cached = await db.books.get(filePath);
  if (cached && cached.parsed) {
    bookCache.set(filePath, cached.bookDoc);
    return cached.bookDoc;
  }
  
  // 重新解析
  const bookDoc = await parseBook(filePath);
  
  // 存入缓存
  bookCache.set(filePath, bookDoc);
  await db.books.put({ path: filePath, bookDoc, parsed: true });
  
  return bookDoc;
}

// 2. Web Worker 解析
// 大文件在 Worker 中解析，不阻塞主线程
const worker = new Worker('./book-parser.worker.ts');
worker.postMessage({ file, format });
worker.onmessage = (e) => {
  const bookDoc = e.data;
  // 继续渲染
};
```

### 6.2 渲染优化

```typescript
// 1. 虚拟滚动 (针对长书籍)
// 只渲染可见章节
const VirtualScroller = ({ sections, renderItem }) => {
  const [visibleRange, setVisibleRange] = useState([0, 10]);
  
  const handleScroll = (e) => {
    const { scrollTop, clientHeight } = e.target;
    const start = Math.floor(scrollTop / ITEM_HEIGHT);
    const end = Math.ceil((scrollTop + clientHeight) / ITEM_HEIGHT);
    setVisibleRange([start, end]);
  };
  
  return (
    <div onScroll={handleScroll}>
      {sections.slice(...visibleRange).map(renderItem)}
    </div>
  );
};

// 2. 懒加载图片
// 使用 Intersection Observer
const LazyImage = ({ src, alt }) => {
  const [isVisible, setIsVisible] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(imgRef.current);
    return () => observer.disconnect();
  }, []);
  
  return <img ref={imgRef} src={isVisible ? src : placeholder} alt={alt} />;
};

// 3. 防抖保存进度
// 避免频繁写入数据库
const saveProgress = debounce((bookId, progress) => {
  db.progress.put({ bookId, progress, timestamp: Date.now() });
}, 5000);
```

### 6.3 内存管理

```typescript
// 1. 非活跃标签页卸载
// 当标签页不可见时，卸载书籍内容
useEffect(() => {
  const handleVisibilityChange = () => {
    if (document.hidden && !isActiveTab) {
      viewRef.current?.book.sections.forEach(s => s.unload?.());
    }
  };
  document.addEventListener('visibilitychange', handleVisibilityChange);
  return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
}, [isActiveTab]);

// 2. 缓存大小限制
class LRUCache<K, V> extends Map<K, V> {
  constructor(private maxSize: number) {
    super();
  }
  
  set(key: K, value: V): this {
    if (this.size >= this.maxSize) {
      const firstKey = this.keys().next().value;
      this.delete(firstKey);
    }
    return super.set(key, value);
  }
}

const bookCache = new LRUCache<string, BookDoc>(5); // 最多缓存5本书
```

## 7. 错误处理策略

### 7.1 分层错误处理

```typescript
// 1. 解析层错误
class BookParseError extends Error {
  constructor(format: string, cause: Error) {
    super(`Failed to parse ${format} book: ${cause.message}`);
    this.name = 'BookParseError';
  }
}

// 2. 渲染层错误
class RenderError extends Error {
  constructor(section: string, cause: Error) {
    super(`Failed to render section ${section}: ${cause.message}`);
    this.name = 'RenderError';
  }
}

// 3. 用户层错误提示
const ErrorBoundary: React.FC = ({ children }) => {
  const [error, setError] = useState<Error | null>(null);
  
  if (error) {
    return (
      <ErrorFallback 
        error={error}
        onRetry={() => setError(null)}
        onReport={() => reportError(error)}
      />
    );
  }
  
  return (
    <ErrorBoundaryContext.Provider value={{ setError }}>
      {children}
    </ErrorBoundaryContext.Provider>
  );
};
```

### 7.2 降级策略

```typescript
// 当主要渲染器失败时，使用降级方案
async function renderBook(file: File): Promise<void> {
  const format = detectFormat(file);
  
  try {
    // 尝试主要方案
    await renderWithFoliate(file, format);
  } catch (error) {
    console.warn('Foliate render failed, trying fallback:', error);
    
    try {
      // 降级方案 1: 使用原生渲染
      if (format === 'PDF') {
        await renderWithPDFJS(file);
      } else if (format === 'EPUB') {
        await renderWithEPUBJS(file);
      }
    } catch (fallbackError) {
      // 降级方案 2: 只显示文本内容
      await renderAsPlainText(file);
    }
  }
}
```
