# FoliateViewer 组件详细实现

## 1. 核心组件实现

基于 Readest 的 `FoliateViewer.tsx`，适配我们的项目架构。

```typescript
// components/reader/FoliateViewer.tsx

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { BookDoc, BookConfig, PageInfo, CFI } from '@/libs/document';
import { FoliateView } from '@/types/view';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';

// Hooks
import { useKeyboard } from './hooks/useKeyboard';
import { useWheel } from './hooks/useWheel';
import { useTouch } from './hooks/useTouch';
import { useFoliateEvents } from './hooks/useFoliateEvents';
import { usePagination } from './hooks/usePagination';

// Utils
import { getStyles, applyThemeModeClass } from '@/utils/style';
import { getMaxInlineSize } from '@/utils/config';
import { getBookDirFromLanguage, getBookDirFromWritingMode } from '@/utils/book';

import Spinner from '@/components/Spinner';

declare global {
  interface Window {
    eval(script: string): void;
  }
}

interface FoliateViewerProps {
  bookKey: string;           // 书籍唯一标识
  bookDoc: BookDoc;          // 解析后的书籍文档
  config: BookConfig;        // 阅读配置
  onLocationChange?: (location: Location, progress: number) => void;
  onLoad?: (info: LoadInfo) => void;
  onError?: (error: Error) => void;
}

export const FoliateViewer: React.FC<FoliateViewerProps> = ({
  bookKey,
  bookDoc,
  config,
  onLocationChange,
  onLoad,
  onError,
}) => {
  // -------------------- Context & Store --------------------
  const { appService } = useEnv();
  const { themeCode, isDarkMode } = useThemeStore();
  const { settings } = useSettingsStore();
  const { setView, setProgress } = useReaderStore();

  // -------------------- Refs --------------------
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoliateView | null>(null);
  const isViewCreated = useRef(false);

  // -------------------- State --------------------
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // -------------------- Hooks --------------------
  const { handleKeyDown } = useKeyboard(viewRef);
  const { handleWheel } = useWheel(viewRef, config.flow);
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useTouch(viewRef);
  
  useFoliateEvents(viewRef, {
    onLocationChange: (e) => {
      const { index, fraction, size } = e.detail;
      const progress = (index + fraction) / size;
      setProgress(bookKey, progress);
      onLocationChange?.(e.detail, progress);
    },
    onLoad: (e) => {
      setIsLoading(false);
      onLoad?.({
        chapterIndex: e.detail.index,
        chapterTitle: bookDoc.toc?.[e.detail.index]?.label || '',
      });
    },
    onError: (e) => {
      setError(e.detail);
      onError?.(e.detail);
    },
  });

  // -------------------- 初始化书籍 --------------------
  useEffect(() => {
    if (isViewCreated.current) return;
    isViewCreated.current = true;

    const openBook = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // 动态导入 foliate-js
        await import('foliate-js/view.js');

        // 创建 foliate-view 元素
        const view = document.createElement('foliate-view') as FoliateView;
        view.id = `foliate-view-${bookKey}`;
        
        // 设置书籍方向
        const writingMode = config.writingMode;
        if (writingMode) {
          const settingsDir = getBookDirFromWritingMode(writingMode);
          const languageDir = getBookDirFromLanguage(bookDoc.metadata.language);
          if (settingsDir !== 'auto') {
            bookDoc.dir = settingsDir;
          } else if (languageDir !== 'auto') {
            bookDoc.dir = languageDir;
          }
        }

        // 配置 fixed-layout (PDF/CBZ)
        if (bookDoc.rendition?.layout === 'pre-paginated' && bookDoc.sections) {
          bookDoc.rendition.spread = config.spreadMode;
          const coverSide = bookDoc.dir === 'rtl' ? 'right' : 'left';
          bookDoc.sections[0]!.pageSpread = config.keepCoverSpread ? '' : coverSide;
        }

        // 打开书籍
        await view.open(bookDoc);
        
        // 保存引用
        viewRef.current = view;
        setView(bookKey, view);

        // 添加到 DOM
        containerRef.current?.appendChild(view);

        // 绑定脚本加载事件
        view.book.transformTarget?.addEventListener('load', (event: Event) => {
          const { detail } = event as CustomEvent;
          if (detail.isScript) {
            detail.allow = config.allowScript ?? false;
          }
        });

        // 初始化位置
        const lastLocation = config.lastLocation;
        if (lastLocation) {
          await view.init({ lastLocation });
        } else {
          await view.init({});
        }

      } catch (err) {
        console.error('Failed to open book:', err);
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsLoading(false);
      }
    };

    openBook();

    // 清理函数
    return () => {
      if (viewRef.current) {
        viewRef.current.destroy?.();
        viewRef.current.remove();
        viewRef.current = null;
      }
      isViewCreated.current = false;
    };
  }, [bookKey, bookDoc]);

  // -------------------- 应用配置变化 --------------------
  useEffect(() => {
    const view = viewRef.current;
    if (!view?.renderer) return;

    const renderer = view.renderer;

    // 应用样式
    renderer.setStyles?.(getStyles(config, themeCode));

    // 应用主题模式
    applyThemeModeClass(renderer, config.theme, isDarkMode);

    // 应用动画
    if (config.animation === 'slide') {
      renderer.setAttribute?.('animated', '');
    } else {
      renderer.removeAttribute?.('animated');
    }

    // 应用布局
    if (bookDoc.rendition?.layout === 'pre-paginated') {
      // Fixed layout (PDF/CBZ)
      renderer.setAttribute?.('zoom', config.zoomMode);
      renderer.setAttribute?.('spread', config.spreadMode);
      renderer.setAttribute?.('scale-factor', String(config.zoomLevel));
    } else {
      // Reflowable layout (EPUB/TXT)
      renderer.setAttribute?.('flow', config.flow);
      renderer.setAttribute?.('max-column-count', String(config.maxColumnCount));
    }

    // 应用尺寸限制
    const maxInlineSize = getMaxInlineSize(config);
    const maxBlockSize = config.maxBlockSize || 1440;
    renderer.setAttribute?.('max-inline-size', `${maxInlineSize}px`);
    renderer.setAttribute?.('max-block-size', `${maxBlockSize}px`);

  }, [config, themeCode, isDarkMode, bookDoc.rendition?.layout]);

  // -------------------- 渲染 --------------------
  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-red-500 mb-2">Failed to load book</p>
          <p className="text-sm text-gray-500">{error.message}</p>
          <button 
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-primary text-white rounded"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full outline-none"
      onKeyDown={handleKeyDown}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      tabIndex={0}
    >
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-50">
          <Spinner size="lg" />
        </div>
      )}
    </div>
  );
};

export default FoliateViewer;
```

## 2. Hooks 详细实现

### 2.1 useKeyboard - 键盘事件处理

```typescript
// hooks/useKeyboard.ts

import { useCallback, RefObject } from 'react';
import { FoliateView } from '@/types/view';

export const useKeyboard = (viewRef: RefObject<FoliateView | null>) => {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const view = viewRef.current;
    if (!view) return;

    // 忽略输入框中的键盘事件
    if (e.target instanceof HTMLInputElement || 
        e.target instanceof HTMLTextAreaElement) {
      return;
    }

    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        view.prev?.();
        break;
      
      case 'ArrowRight':
      case 'ArrowDown':
      case ' ':
      case 'PageDown':
        e.preventDefault();
        view.next?.();
        break;
      
      case 'PageUp':
        e.preventDefault();
        view.prev?.();
        break;
      
      case 'Home':
        e.preventDefault();
        view.goTo?.(0);
        break;
      
      case 'End':
        e.preventDefault();
        view.goTo?.(view.book.sections.length - 1);
        break;
      
      case 'Escape':
        // 关闭弹窗、退出全屏等
        break;
      
      default:
        // 其他快捷键
        if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          // 打开搜索
        }
        break;
    }
  }, [viewRef]);

  return { handleKeyDown };
};
```

### 2.2 useWheel - 滚轮事件处理

```typescript
// hooks/useWheel.ts

import { useCallback, useRef, RefObject } from 'react';
import { FoliateView } from '@/types/view';

export const useWheel = (
  viewRef: RefObject<FoliateView | null>,
  flow: 'paginated' | 'scrolled'
) => {
  const wheelCooldown = useRef(false);
  const accumulatedDelta = useRef(0);

  const handleWheel = useCallback((e: WheelEvent) => {
    const view = viewRef.current;
    if (!view) return;

    // 忽略输入框中的滚轮事件
    if (e.target instanceof HTMLInputElement || 
        e.target instanceof HTMLTextAreaElement) {
      return;
    }

    // 滚动模式下，让浏览器自然滚动
    if (flow === 'scrolled') {
      return;
    }

    // 分页模式下，拦截滚轮事件
    e.preventDefault();

    // 累积滚动距离
    accumulatedDelta.current += e.deltaY;

    // 冷却时间防止过快翻页
    if (wheelCooldown.current) return;

    const threshold = 50; // 触发翻页的阈值

    if (Math.abs(accumulatedDelta.current) > threshold) {
      wheelCooldown.current = true;
      
      if (accumulatedDelta.current > 0) {
        view.next?.();
      } else {
        view.prev?.();
      }

      accumulatedDelta.current = 0;

      setTimeout(() => {
        wheelCooldown.current = false;
      }, 300);
    }
  }, [viewRef, flow]);

  return { handleWheel };
};
```

### 2.3 useTouch - 触摸事件处理

```typescript
// hooks/useTouch.ts

import { useCallback, useRef, RefObject } from 'react';
import { FoliateView } from '@/types/view';

interface TouchState {
  startX: number;
  startY: number;
  startTime: number;
}

export const useTouch = (viewRef: RefObject<FoliateView | null>) => {
  const touchState = useRef<TouchState | null>(null);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    touchState.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: Date.now(),
    };
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    // 可以在这里处理滑动过程中的视觉反馈
  }, []);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    const view = viewRef.current;
    if (!view || !touchState.current) return;

    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchState.current.startX;
    const deltaY = touch.clientY - touchState.current.startY;
    const deltaTime = Date.now() - touchState.current.startTime;

    // 判断滑动方向和距离
    const minSwipeDistance = 50;
    const maxSwipeTime = 300;

    if (deltaTime > maxSwipeTime) return;

    if (Math.abs(deltaX) > Math.abs(deltaY) && 
        Math.abs(deltaX) > minSwipeDistance) {
      // 水平滑动
      if (deltaX > 0) {
        view.prev?.();
      } else {
        view.next?.();
      }
    }

    touchState.current = null;
  }, [viewRef]);

  return {
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  };
};
```

### 2.4 useFoliateEvents - foliate 事件绑定

```typescript
// hooks/useFoliateEvents.ts

import { useEffect, RefObject } from 'react';
import { FoliateView } from '@/types/view';

interface FoliateEventHandlers {
  onLocationChange?: (e: CustomEvent) => void;
  onLoad?: (e: CustomEvent) => void;
  onError?: (e: CustomEvent) => void;
  onRelocate?: (e: CustomEvent) => void;
}

export const useFoliateEvents = (
  viewRef: RefObject<FoliateView | null>,
  handlers: FoliateEventHandlers
) => {
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    // 绑定事件
    if (handlers.onLocationChange) {
      view.addEventListener('relocate', handlers.onLocationChange);
    }
    if (handlers.onLoad) {
      view.addEventListener('load', handlers.onLoad);
    }
    if (handlers.onError) {
      view.addEventListener('error', handlers.onError);
    }

    return () => {
      // 清理事件监听
      if (handlers.onLocationChange) {
        view.removeEventListener('relocate', handlers.onLocationChange);
      }
      if (handlers.onLoad) {
        view.removeEventListener('load', handlers.onLoad);
      }
      if (handlers.onError) {
        view.removeEventListener('error', handlers.onError);
      }
    };
  }, [viewRef, handlers]);
};
```

## 3. 样式系统

```typescript
// utils/style.ts

import { BookConfig } from '@/types/book';

export interface ThemeColors {
  background: string;
  text: string;
  link: string;
  highlight: string;
}

export const themes: Record<string, ThemeColors> = {
  light: {
    background: '#ffffff',
    text: '#1a1a1a',
    link: '#0066cc',
    highlight: 'rgba(255, 255, 0, 0.3)',
  },
  dark: {
    background: '#1a1a1a',
    text: '#e5e5e5',
    link: '#4da3ff',
    highlight: 'rgba(255, 255, 0, 0.2)',
  },
  sepia: {
    background: '#f4ecd8',
    text: '#5b4636',
    link: '#8b6914',
    highlight: 'rgba(255, 255, 0, 0.3)',
  },
};

export const getStyles = (
  config: BookConfig,
  themeCode: string
): Record<string, string> => {
  const theme = themes[config.theme] || themes.light;

  return {
    'html, body': `
      background-color: ${theme.background} !important;
      color: ${theme.text} !important;
      font-family: ${config.fontFamily}, system-ui, sans-serif !important;
      font-size: ${config.fontSize}px !important;
      line-height: ${config.lineHeight} !important;
      text-align: ${config.textAlign} !important;
    `,
    'a': `
      color: ${theme.link} !important;
      text-decoration: ${config.underlineLinks ? 'underline' : 'none'} !important;
    `,
    '::selection': `
      background: ${theme.highlight} !important;
    `,
    'img': `
      max-width: 100% !important;
      height: auto !important;
    `,
    'pre, code': `
      font-family: 'Fira Code', monospace !important;
      background-color: rgba(0, 0, 0, 0.05) !important;
      border-radius: 4px !important;
    `,
  };
};

export const applyThemeModeClass = (
  renderer: any,
  theme: string,
  isDarkMode: boolean
) => {
  if (theme === 'dark' || (theme === 'auto' && isDarkMode)) {
    renderer.setAttribute?.('data-theme', 'dark');
  } else {
    renderer.removeAttribute?.('data-theme');
  }
};
```

## 4. 类型定义

```typescript
// types/view.ts

import { BookDoc } from '@/libs/document';

export interface FoliateView extends HTMLElement {
  book: BookDoc;
  renderer: FoliateRenderer;
  
  open(book: BookDoc): Promise<void>;
  init(options: { lastLocation?: string; showTextStart?: boolean }): Promise<void>;
  goTo(target: string | number): Promise<void>;
  goToFraction(fraction: number): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  destroy(): void;
}

export interface FoliateRenderer {
  setStyles(styles: Record<string, string>): void;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  
  // 分页相关
  getContents(): Array<{ doc: Document; index: number }>;
}

export interface Location {
  index: number;
  fraction: number;
  range: Range | null;
  cfi: string;
}

export interface LoadInfo {
  chapterIndex: number;
  chapterTitle: string;
}
```

## 5. 使用示例

```typescript
// 在 ReaderView 中使用

const ReaderView: React.FC = () => {
  const { bookDoc, config } = useReaderStore();
  
  if (!bookDoc) {
    return <LoadingSpinner />;
  }

  return (
    <div className="h-full w-full">
      <FoliateViewer
        bookKey={book.id}
        bookDoc={bookDoc}
        config={config}
        onLocationChange={(location, progress) => {
          saveProgress(book.id, progress, location.cfi);
        }}
        onLoad={(info) => {
          console.log('Loaded chapter:', info.chapterTitle);
        }}
        onError={(error) => {
          toast.error('Failed to render book: ' + error.message);
        }}
      />
    </div>
  );
};
```

## 6. 注意事项

1. **内存管理**: 组件卸载时必须调用 `view.destroy()` 释放资源
2. **事件委托**: 键盘/滚轮事件在容器上捕获，通过 ref 传递给 foliate-view
3. **配置响应**: 所有配置变化通过 useEffect 响应，实时更新渲染
4. **错误边界**: 建议在外层包裹 React Error Boundary 捕获渲染错误
