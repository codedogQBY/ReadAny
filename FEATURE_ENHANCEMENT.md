# ReadAny 功能增强方案

> 文档版本: v1.0
> 日期: 2026-02-26
> 状态: 规划中

---

## 目录

1. [概述](#概述)
2. [P0 - 核心功能缺失](#p0---核心功能缺失)
   - [EPUB 渲染器实现](#1-epub-渲染器实现)
   - [PDF 渲染器实现](#2-pdf-渲染器实现)
   - [RAG 工具实现](#3-rag-工具实现)
   - [向量化管道](#4-向量化管道)
3. [P1 - 重要功能增强](#p1---重要功能增强)
   - [批注导出功能](#5-批注导出功能)
   - [AI 流式输出](#6-ai-流式输出)
   - [划词翻译](#7-划词翻译)
   - [阅读统计可视化](#8-阅读统计可视化)
4. [P2 - 体验优化](#p2---体验优化)
   - [云同步功能](#9-云同步功能)
   - [多格式支持](#10-多格式支持)
   - [TTS 朗读](#11-tts-朗读)
   - [阅读计划](#12-阅读计划)
5. [P3 - 创新功能](#p3---创新功能)
   - [知识图谱](#13-知识图谱)
   - [AI 共读模式](#14-ai-共读模式)
   - [间隔重复复习](#15-间隔重复复习)
6. [架构改进建议](#架构改进建议)
7. [实施优先级总览](#实施优先级总览)

---

## 概述

本文档基于对 ReadAny 项目代码的深入分析，识别出现有功能的缺失点，并提供详细的技术解决方案。按照优先级分为 P0（核心缺失）、P1（重要增强）、P2（体验优化）、P3（创新功能）四个级别。

### 现状分析

| 模块 | 完成度 | 备注 |
|------|--------|------|
| 数据库 Schema | 90% | 结构完整，索引合理 |
| 类型定义 | 85% | 核心类型齐全 |
| EPUB 渲染 | 5% | 仅有占位符 |
| PDF 渲染 | 0% | 未实现 |
| RAG 工具 | 10% | 接口定义，实现为空 |
| 向量化 | 15% | chunker 完成，embedding 未实现 |
| AI 对话 | 30% | 消息管道完成，流式未实现 |
| 批注系统 | 40% | 存储完成，导出未实现 |
| 翻译 | 10% | 接口定义，实现为空 |
| 同步 | 5% | 框架代码，逻辑为空 |

---

## P0 - 核心功能缺失

### 1. EPUB 渲染器实现

**现状**: `ReaderView.tsx` 仅有占位符，无实际渲染逻辑。

**技术方案**:

#### 1.1 技术选型

推荐使用 **foliate-js** 而非 epub.js，理由：

| 对比项 | epub.js | foliate-js |
|--------|---------|------------|
| 包体积 | 较大 (~500KB) | 轻量 (~50KB) |
| CFI 支持 | ✅ | ✅ |
| 多格式扩展 | 仅 EPUB | EPUB/PDF/MOBI/FB2/CBZ |
| 注解渲染 | marks-pane | overlayer (更灵活) |
| 滚动/分页切换 | 需重新加载 | 运行时切换 |
| 维护状态 | 活跃 | 活跃 |

#### 1.2 核心接口设计

```typescript
// src/lib/reader/document-renderer.ts

export interface Location {
  type: 'cfi' | 'page-coord';
  // EPUB
  cfi?: string;
  chapterIndex?: number;
  // PDF
  pageIndex?: number;
  rect?: [number, number, number, number];
}

export interface Selection {
  text: string;
  start: Location;
  end: Location;
  rects: DOMRect[];
}

export interface RendererEvents {
  'location-change': (location: Location, progress: number) => void;
  'selection': (selection: Selection | null) => void;
  'load': (chapterIndex: number) => void;
  'error': (error: Error) => void;
}

export interface DocumentRenderer {
  // 生命周期
  mount(container: HTMLElement): Promise<void>;
  destroy(): void;
  
  // 导航
  goTo(location: Location): Promise<void>;
  goToIndex(index: number): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  
  // 信息
  getTOC(): TOCItem[];
  getCurrentLocation(): Location;
  getProgress(): number;
  
  // 选区
  getSelection(): Selection | null;
  
  // 注解
  addAnnotation(annotation: Annotation): void;
  removeAnnotation(id: string): void;
  
  // 事件
  on<K extends keyof RendererEvents>(event: K, callback: RendererEvents[K]): void;
  off<K extends keyof RendererEvents>(event: K, callback: RendererEvents[K]): void;
}
```

#### 1.3 EPUB 渲染器实现

```typescript
// src/lib/reader/epub-renderer.ts

import { View } from 'foliate-js/view.js';
import { Overlayer } from 'foliate-js/overlayer.js';
import type { DocumentRenderer, Location, Selection, Annotation } from './document-renderer';

export class EPUBRenderer implements DocumentRenderer {
  private view: View | null = null;
  private container: HTMLElement | null = null;
  private book: any = null;
  private overlayer: Overlayer | null = null;
  private annotations: Map<string, Annotation> = new Map();
  private eventListeners: Map<string, Set<Function>> = new Map();
  
  async mount(container: HTMLElement): Promise<void> {
    this.container = container;
    
    // 创建 foliate view
    this.view = document.createElement('foliate-view') as View;
    container.appendChild(this.view);
    
    // 监听事件
    this.view.addEventListener('relocate', (e: CustomEvent) => {
      const { index, fraction, range } = e.detail;
      this.emit('location-change', {
        type: 'cfi',
        chapterIndex: index,
        cfi: this.rangeToCFI(range),
      }, fraction);
    });
    
    // 设置 overlayer 用于注解渲染
    this.view.addEventListener('create-overlayer', (e: CustomEvent) => {
      const { doc, index, attach } = e.detail;
      this.overlayer = new Overlayer();
      this.renderAnnotations();
      attach(this.overlayer);
    });
  }
  
  async load(bookId: string, file: Blob): Promise<void> {
    await this.view?.open(file);
    this.book = await this.view?.book;
  }
  
  async goTo(location: Location): Promise<void> {
    if (location.type === 'cfi' && location.cfi) {
      await this.view?.goTo(location.cfi);
    } else if (location.chapterIndex !== undefined) {
      await this.view?.goTo(location.chapterIndex);
    }
  }
  
  async next(): Promise<void> {
    await this.view?.next();
  }
  
  async prev(): Promise<void> {
    await this.view?.prev();
  }
  
  getTOC(): TOCItem[] {
    return this.book?.toc || [];
  }
  
  getCurrentLocation(): Location {
    const detail = this.view?.getDetail?.();
    return {
      type: 'cfi',
      cfi: detail?.cfi || '',
      chapterIndex: detail?.index,
    };
  }
  
  getProgress(): number {
    const detail = this.view?.getDetail?.();
    return detail?.fraction || 0;
  }
  
  getSelection(): Selection | null {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return null;
    
    const range = selection.getRangeAt(0);
    const text = selection.toString();
    
    return {
      text,
      start: { type: 'cfi', cfi: this.rangeToCFI(range) },
      end: { type: 'cfi', cfi: this.rangeToCFI(range, true) },
      rects: Array.from(range.getClientRects()),
    };
  }
  
  addAnnotation(annotation: Annotation): void {
    this.annotations.set(annotation.id, annotation);
    this.renderAnnotation(annotation);
  }
  
  removeAnnotation(id: string): void {
    this.annotations.delete(id);
    this.overlayer?.redraw();
  }
  
  private renderAnnotation(annotation: Annotation): void {
    if (!this.overlayer || annotation.location.type !== 'cfi') return;
    
    // 使用 overlayer 绘制高亮
    this.overlayer.add({
      range: this.cfiToRange(annotation.location.cfi!),
      draw: (ctx: CanvasRenderingContext2D, rect: DOMRect) => {
        ctx.fillStyle = annotation.color || 'rgba(255, 255, 0, 0.3)';
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      },
    });
  }
  
  private renderAnnotations(): void {
    this.annotations.forEach(a => this.renderAnnotation(a));
  }
  
  destroy(): void {
    this.view?.remove();
    this.view = null;
    this.container = null;
  }
  
  // ... 事件处理方法
  on(event: string, callback: Function): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
  }
  
  off(event: string, callback: Function): void {
    this.eventListeners.get(event)?.delete(callback);
  }
  
  private emit(event: string, ...args: any[]): void {
    this.eventListeners.get(event)?.forEach(cb => cb(...args));
  }
}
```

#### 1.4 文件结构

```
src/lib/reader/
├── document-renderer.ts    # 统一接口
├── epub-renderer.ts        # EPUB 实现
├── pdf-renderer.ts         # PDF 实现
├── annotation-overlay.ts   # 注解渲染层
├── location-utils.ts       # 位置工具函数
└── index.ts                # 导出
```

#### 1.5 依赖添加

```bash
pnpm add foliate-js
# 或作为 git submodule
git submodule add https://github.com/johnfactotum/foliate-js.git
```

---

### 2. PDF 渲染器实现

**现状**: 完全未实现。

**技术方案**:

#### 2.1 技术选型

使用 **PDF.js** + 自定义注解层：

```typescript
// src/lib/reader/pdf-renderer.ts

import * as pdfjsLib from 'pdfjs-dist';
import type { DocumentRenderer, Location, Selection, Annotation } from './document-renderer';

export class PDFRenderer implements DocumentRenderer {
  private container: HTMLElement | null = null;
  private pdfDoc: pdfjsLib.PDFDocumentProxy | null = null;
  private currentPage: number = 1;
  private totalPages: number = 0;
  private scale: number = 1.5;
  private pageContainer: HTMLElement | null = null;
  private annotationLayer: SVGElement | null = null;
  private annotations: Map<string, Annotation> = new Map();
  
  async mount(container: HTMLElement): Promise<void> {
    this.container = container;
    
    // 创建页面容器
    this.pageContainer = document.createElement('div');
    this.pageContainer.className = 'pdf-pages';
    container.appendChild(this.pageContainer);
    
    // 创建注解 SVG 层
    this.annotationLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.annotationLayer.className = 'annotation-layer';
    container.appendChild(this.annotationLayer);
  }
  
  async load(bookId: string, file: Blob): Promise<void> {
    const arrayBuffer = await file.arrayBuffer();
    this.pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    this.totalPages = this.pdfDoc.numPages;
    
    await this.renderPage(1);
  }
  
  private async renderPage(pageNum: number): Promise<void> {
    if (!this.pdfDoc || !this.pageContainer) return;
    
    const page = await this.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: this.scale });
    
    // 清空并创建 canvas
    this.pageContainer.innerHTML = '';
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    this.pageContainer.appendChild(canvas);
    
    // 渲染 PDF 页面
    await page.render({
      canvasContext: ctx,
      viewport,
    }).promise;
    
    // 创建文本层（用于选择）
    const textLayer = document.createElement('div');
    textLayer.className = 'text-layer';
    this.pageContainer.appendChild(textLayer);
    
    await this.renderTextLayer(page, viewport, textLayer);
    
    // 更新注解层尺寸
    this.updateAnnotationLayer(viewport);
    this.renderAnnotations();
    
    this.currentPage = pageNum;
    this.emit('location-change', {
      type: 'page-coord',
      pageIndex: pageNum - 1,
    }, pageNum / this.totalPages);
  }
  
  private async renderTextLayer(
    page: pdfjsLib.PDFPageProxy,
    viewport: pdfjsLib.PageViewport,
    container: HTMLElement
  ): Promise<void> {
    const textContent = await page.getTextContent();
    
    // 使用 PDF.js 的文本层渲染
    pdfjsLib.renderTextLayer({
      textContentSource: textContent,
      container,
      viewport,
    });
  }
  
  private updateAnnotationLayer(viewport: pdfjsLib.PageViewport): void {
    if (!this.annotationLayer) return;
    this.annotationLayer.setAttribute('width', String(viewport.width));
    this.annotationLayer.setAttribute('height', String(viewport.height));
    this.annotationLayer.style.position = 'absolute';
    this.annotationLayer.style.top = '0';
    this.annotationLayer.style.left = '0';
    this.annotationLayer.style.pointerEvents = 'none';
  }
  
  async goTo(location: Location): Promise<void> {
    if (location.type === 'page-coord' && location.pageIndex !== undefined) {
      await this.renderPage(location.pageIndex + 1);
    }
  }
  
  async next(): Promise<void> {
    if (this.currentPage < this.totalPages) {
      await this.renderPage(this.currentPage + 1);
    }
  }
  
  async prev(): Promise<void> {
    if (this.currentPage > 1) {
      await this.renderPage(this.currentPage - 1);
    }
  }
  
  getSelection(): Selection | null {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return null;
    
    const range = selection.getRangeAt(0);
    const text = selection.toString();
    const rects = Array.from(range.getClientRects());
    
    // 计算相对于页面的坐标
    const containerRect = this.container?.getBoundingClientRect();
    const normalizedRects = rects.map(rect => {
      const pageRect = this.pageContainer?.getBoundingClientRect();
      return [
        (rect.left - (pageRect?.left || 0)) / (pageRect?.width || 1),
        (rect.top - (pageRect?.top || 0)) / (pageRect?.height || 1),
        (rect.right - (pageRect?.left || 0)) / (pageRect?.width || 1),
        (rect.bottom - (pageRect?.top || 0)) / (pageRect?.height || 1),
      ] as [number, number, number, number];
    });
    
    return {
      text,
      start: {
        type: 'page-coord',
        pageIndex: this.currentPage - 1,
        rect: normalizedRects[0],
      },
      end: {
        type: 'page-coord',
        pageIndex: this.currentPage - 1,
        rect: normalizedRects[normalizedRects.length - 1],
      },
      rects,
    };
  }
  
  addAnnotation(annotation: Annotation): void {
    this.annotations.set(annotation.id, annotation);
    this.renderAnnotations();
  }
  
  removeAnnotation(id: string): void {
    this.annotations.delete(id);
    this.renderAnnotations();
  }
  
  private renderAnnotations(): void {
    if (!this.annotationLayer) return;
    this.annotationLayer.innerHTML = '';
    
    const pageRect = this.pageContainer?.getBoundingClientRect();
    if (!pageRect) return;
    
    this.annotations.forEach(annotation => {
      if (annotation.location.type !== 'page-coord') return;
      if (annotation.location.pageIndex !== this.currentPage - 1) return;
      
      const rect = annotation.location.rect;
      if (!rect) return;
      
      // 反归一化坐标
      const x = rect[0] * pageRect.width;
      const y = rect[1] * pageRect.height;
      const width = (rect[2] - rect[0]) * pageRect.width;
      const height = (rect[3] - rect[1]) * pageRect.height;
      
      const highlight = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      highlight.setAttribute('x', String(x));
      highlight.setAttribute('y', String(y));
      highlight.setAttribute('width', String(width));
      highlight.setAttribute('height', String(height));
      highlight.setAttribute('fill', annotation.color || 'rgba(255, 255, 0, 0.3)');
      highlight.setAttribute('pointer-events', 'auto');
      highlight.setAttribute('data-annotation-id', annotation.id);
      
      this.annotationLayer!.appendChild(highlight);
    });
  }
  
  getTOC(): TOCItem[] {
    // PDF 可能没有目录，尝试从大纲获取
    // TODO: 实现 PDF 大纲解析
    return [];
  }
  
  getCurrentLocation(): Location {
    return {
      type: 'page-coord',
      pageIndex: this.currentPage - 1,
    };
  }
  
  getProgress(): number {
    return this.currentPage / this.totalPages;
  }
  
  destroy(): void {
    this.pdfDoc?.destroy();
    this.pageContainer?.remove();
    this.annotationLayer?.remove();
  }
  
  // ... 事件处理方法 (同 EPUB)
}
```

#### 2.2 类型扩展

```typescript
// src/types/annotation.ts 扩展

export interface Annotation {
  id: string;
  bookId: string;
  text: string;
  note?: string;
  color: HighlightColor;
  createdAt: number;
  updatedAt: number;
  
  // 统一位置标识
  location: EPUBLocation | PDFLocation;
}

export interface EPUBLocation {
  type: 'cfi';
  cfi: string;
  chapterIndex: number;
}

export interface PDFLocation {
  type: 'page-coord';
  pageIndex: number;
  rect?: [number, number, number, number]; // 归一化坐标 0-1
}
```

---

### 3. RAG 工具实现

**现状**: `tools.ts` 中所有工具返回空结果。

**技术方案**:

> 📚 **业界最佳实践 (2024-2025)**
>
> 本方案整合了 Anthropic、Cohere、RAGFlow 等业界领先的 RAG 技术研究：
> - **Contextual Retrieval** (Anthropic) — 检索失败率降低 49%
> - **Reranking** (Cohere) — 额外降低 18% 失败率
> - **HyDE** — 解决 Query-Document 语义鸿沟
> - **Multi-Query** — 多角度查询扩展

#### 3.1 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                     Advanced RAG Pipeline                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐    ┌──────────────┐    ┌─────────────┐            │
│  │  Query   │ -> │ Query Expand │ -> │   Hybrid    │            │
│  │          │    │ (Multi-Query)│    │   Search    │            │
│  └──────────┘    └──────────────┘    └──────┬──────┘            │
│                                              │                   │
│                                              v                   │
│              ┌───────────────────────────────────────┐           │
│              │  Vector Search + BM25 + RRF Fusion    │           │
│              │           (Top 100 Candidates)        │           │
│              └───────────────────┬───────────────────┘           │
│                                  │                               │
│                                  v                               │
│                        ┌─────────────────┐                       │
│                        │   Reranking     │                       │
│                        │ (Cross-Encoder) │                       │
│                        │   (Top 20)      │                       │
│                        └────────┬────────┘                       │
│                                 │                                │
│                                 v                                │
│                        ┌─────────────────┐                       │
│                        │   LLM Context   │                       │
│                        └─────────────────┘                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

Offline Processing:
┌─────────────────────────────────────────────────────────────────┐
│  Document -> Chunking -> Contextualize -> Embed -> Store        │
│                         (Anthropic)                              │
└─────────────────────────────────────────────────────────────────┘
```

#### 3.2 Contextual Retrieval（核心增强）

**问题**：分块后语义丢失

```
原 chunk: "公司收入增长了 3%"
问题: 哪个公司？哪个季度？
```

**Anthropic 方案**：用 LLM 为每个 chunk 添加上下文

```typescript
// src/lib/rag/contextual-retrieval.ts

/**
 * Contextual Retrieval - Anthropic 2024
 * 检索失败率降低 49%
 */
export class ContextualRetrieval {
  private llm: LLMService;
  
  /**
   * 为 chunk 添加文档上下文
   * 成本: $1.02 / 百万 token (使用 Prompt Caching)
   */
  async contextualizeChunk(
    wholeDocument: string,
    chunk: string,
    options?: { maxContextTokens?: number }
  ): Promise<{ context: string; contextualizedChunk: string }> {
    const prompt = `<document> 
${wholeDocument.slice(0, 10000)} 
</document> 
Here is the chunk we want to situate within the whole document 
<chunk> 
${chunk} 
</chunk> 
Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. Answer only with the succinct context and nothing else.`;

    const context = await this.llm.complete(prompt, {
      maxTokens: options?.maxContextTokens || 100,
    });
    
    return {
      context,
      contextualizedChunk: context + "\n" + chunk,
    };
  }
  
  /**
   * 批量处理文档 chunks
   */
  async contextualizeDocument(
    document: string,
    chunks: string[],
    onProgress?: (progress: number) => void
  ): Promise<string[]> {
    const results: string[] = [];
    
    for (let i = 0; i < chunks.length; i++) {
      const { contextualizedChunk } = await this.contextualizeChunk(
        document,
        chunks[i]
      );
      results.push(contextualizedChunk);
      onProgress?.((i + 1) / chunks.length);
    }
    
    return results;
  }
}
```

#### 3.3 Reranking 精排

```typescript
// src/lib/rag/reranker.ts

/**
 * Reranking - 使用 Cross-Encoder 精确打分
 * 额外降低 18% 失败率
 */
export interface RerankerOptions {
  provider: 'cohere' | 'voyage' | 'local';
  apiKey?: string;
  topN: number;
}

export class Reranker {
  private options: RerankerOptions;
  
  constructor(options: RerankerOptions) {
    this.options = options;
  }
  
  /**
   * 对候选结果重排序
   */
  async rerank(
    query: string,
    candidates: SearchResult[],
    topN?: number
  ): Promise<SearchResult[]> {
    if (candidates.length === 0) return [];
    
    switch (this.options.provider) {
      case 'cohere':
        return this.rerankWithCohere(query, candidates, topN);
      case 'voyage':
        return this.rerankWithVoyage(query, candidates, topN);
      case 'local':
        return this.rerankLocal(query, candidates, topN);
      default:
        return candidates.slice(0, topN || this.options.topN);
    }
  }
  
  private async rerankWithCohere(
    query: string,
    candidates: SearchResult[],
    topN?: number
  ): Promise<SearchResult[]> {
    const response = await fetch('https://api.cohere.ai/v1/rerank', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model: 'rerank-multilingual-v3.0',
        query,
        documents: candidates.map(c => c.chunk.content),
        top_n: topN || this.options.topN,
      }),
    });
    
    const data = await response.json();
    
    return data.results.map((r: any) => ({
      ...candidates[r.index],
      score: r.relevance_score,
      matchType: 'reranked' as const,
    }));
  }
  
  /**
   * 本地 Reranking (使用小模型)
   */
  private async rerankLocal(
    query: string,
    candidates: SearchResult[],
    topN?: number
  ): Promise<SearchResult[]> {
    // 使用 cross-encoder 模型
    // 可以部署在本地或使用 Hugging Face Inference API
    const scores = await Promise.all(
      candidates.map(async (c) => {
        const score = await this.computeRelevanceScore(query, c.chunk.content);
        return { ...c, score };
      })
    );
    
    return scores
      .sort((a, b) => b.score - a.score)
      .slice(0, topN || this.options.topN);
  }
  
  private async computeRelevanceScore(query: string, doc: string): Promise<number> {
    // 使用本地 cross-encoder 或调用 LLM 打分
    // 简化实现：使用 cosine similarity
    return 0.5; // placeholder
  }
}
```

#### 3.4 HyDE 假设文档嵌入

```typescript
// src/lib/rag/hyde.ts

/**
 * HyDE - Hypothetical Document Embeddings
 * 解决 Query 与 Document 的语义鸿沟
 */
export class HyDERetriever {
  private llm: LLMService;
  private embeddingService: EmbeddingService;
  private searchPipeline: RAGSearchPipeline;
  
  /**
   * 生成假设答案并检索
   */
  async retrieve(
    query: string,
    bookId: string,
    topK: number = 10
  ): Promise<SearchResult[]> {
    // 1. 生成假设文档
    const hypotheticalDoc = await this.generateHypotheticalDocument(query);
    
    // 2. 用假设文档 embedding 检索
    const embedding = await this.embeddingService.embed(hypotheticalDoc);
    const results = await this.searchPipeline.vectorSearchByEmbedding(
      embedding,
      bookId,
      topK
    );
    
    return results;
  }
  
  private async generateHypotheticalDocument(query: string): Promise<string> {
    const prompt = `Please write a detailed passage that could answer the following question. Be specific and informative.

Question: ${query}

Passage:`;
    
    return await this.llm.complete(prompt, { maxTokens: 500 });
  }
}
```

#### 3.5 Multi-Query 多查询扩展

```typescript
// src/lib/rag/multi-query.ts

/**
 * Multi-Query - 从多个角度检索
 * 提高召回率 15-25%
 */
export class MultiQueryRetriever {
  private llm: LLMService;
  private searchPipeline: RAGSearchPipeline;
  
  /**
   * 生成多个相关查询并检索
   */
  async retrieve(
    query: string,
    bookId: string,
    options?: {
      numQueries?: number;
      topKPerQuery?: number;
      finalTopK?: number;
    }
  ): Promise<SearchResult[]> {
    const numQueries = options?.numQueries || 3;
    const topKPerQuery = options?.topKPerQuery || 10;
    const finalTopK = options?.finalTopK || 20;
    
    // 1. 生成多个查询
    const queries = await this.generateQueries(query, numQueries);
    queries.unshift(query); // 包含原查询
    
    // 2. 并行检索
    const allResults = await Promise.all(
      queries.map(q => 
        this.searchPipeline.hybridSearch(q, bookId, topKPerQuery)
      )
    );
    
    // 3. RRF 融合
    return this.rrfFusion(allResults, finalTopK);
  }
  
  private async generateQueries(
    originalQuery: string,
    numQueries: number
  ): Promise<string[]> {
    const prompt = `You are an AI language model assistant. Your task is to generate ${numQueries} different versions of the given user question to retrieve relevant documents from a vector database. 
By generating multiple perspectives on the user question, your goal is to help the user overcome some of the limitations of distance-based similarity search.

Provide these alternative questions separated by newlines.

Original question: ${originalQuery}`;

    const response = await this.llm.complete(prompt);
    return response.split('\n').filter(q => q.trim().length > 0);
  }
  
  private rrfFusion(
    resultSets: SearchResult[][],
    topK: number,
    k: number = 60
  ): SearchResult[] {
    const scores = new Map<string, { result: SearchResult; score: number }>();
    
    resultSets.forEach(results => {
      results.forEach((r, i) => {
        const id = r.chunk.id;
        const existing = scores.get(id);
        if (existing) {
          existing.score += 1 / (k + i + 1);
        } else {
          scores.set(id, { result: r, score: 1 / (k + i + 1) });
        }
      });
    });
    
    return Array.from(scores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(s => ({ ...s.result, score: s.score, matchType: 'multi-query' as const }));
  }
}
```

#### 3.6 增强型搜索管道

```typescript
// src/lib/rag/search-pipeline.ts

import type { Chunk, SearchResult, SearchQuery } from '@/types';

export interface SearchPipeline {
  search(query: SearchQuery): Promise<SearchResult[]>;
  hybridSearch(query: string, bookId: string, topK: number): Promise<SearchResult[]>;
  vectorSearch(query: string, bookId: string, topK: number): Promise<SearchResult[]>;
  bm25Search(query: string, bookId: string, topK: number): Promise<SearchResult[]>;
  advancedSearch(query: string, bookId: string, options?: AdvancedSearchOptions): Promise<SearchResult[]>;
}

export interface AdvancedSearchOptions {
  useHyDE?: boolean;
  useMultiQuery?: boolean;
  useReranking?: boolean;
  numQueries?: number;
  candidateMultiplier?: number; // 候选数量倍数
}

/**
 * 增强型 RAG 搜索管道
 * 整合业界最佳实践
 */
export class RAGSearchPipeline implements SearchPipeline {
  private db: Database;
  private embeddingService: EmbeddingService;
  private reranker: Reranker;
  private hydeRetriever: HyDERetriever;
  private multiQueryRetriever: MultiQueryRetriever;
  
  constructor(
    db: Database,
    embeddingService: EmbeddingService,
    reranker: Reranker
  ) {
    this.db = db;
    this.embeddingService = embeddingService;
    this.reranker = reranker;
    this.hydeRetriever = new HyDERetriever(embeddingService, this);
    this.multiQueryRetriever = new MultiQueryRetriever(this);
  }
  
  /**
   * 高级搜索 - 整合所有优化技术
   */
  async advancedSearch(
    query: string,
    bookId: string,
    options: AdvancedSearchOptions = {}
  ): Promise<SearchResult[]> {
    const {
      useHyDE = false,
      useMultiQuery = true,
      useReranking = true,
      numQueries = 3,
      candidateMultiplier = 5,
    } = options;
    
    const finalTopK = 20;
    const candidateCount = finalTopK * candidateMultiplier;
    
    let candidates: SearchResult[];
    
    // 阶段 1: 召回 (Recall)
    if (useMultiQuery) {
      // Multi-Query 召回
      candidates = await this.multiQueryRetriever.retrieve(query, bookId, {
        numQueries,
        topKPerQuery: Math.ceil(candidateCount / numQueries),
        finalTopK: candidateCount,
      });
    } else if (useHyDE) {
      // HyDE 召回
      candidates = await this.hydeRetriever.retrieve(query, bookId, candidateCount);
    } else {
      // 标准 Hybrid 召回
      candidates = await this.hybridSearch(query, bookId, candidateCount);
    }
    
    // 阶段 2: 精排 (Precision)
    if (useReranking && candidates.length > finalTopK) {
      candidates = await this.reranker.rerank(query, candidates, finalTopK);
    }
    
    return candidates;
  }
  
  /**
   * 标准 Hybrid Search
   */
  async hybridSearch(query: string, bookId: string, topK: number): Promise<SearchResult[]> {
    const [vectorResults, bm25Results] = await Promise.all([
      this.vectorSearch(query, bookId, topK * 2),
      this.bm25Search(query, bookId, topK * 2),
    ]);
    
    return this.rrfFusion(vectorResults, bm25Results, topK);
  }
  
  async vectorSearch(query: string, bookId: string, topK: number): Promise<SearchResult[]> {
    const queryEmbedding = await this.embeddingService.embed(query);
    return this.vectorSearchByEmbedding(queryEmbedding, bookId, topK);
  }
  
  async vectorSearchByEmbedding(
    embedding: number[],
    bookId: string,
    topK: number
  ): Promise<SearchResult[]> {
    const chunks = await this.db.getChunksByBook(bookId);
    
    const results = chunks
      .filter(c => c.embedding)
      .map(chunk => ({
        chunk,
        score: this.cosineSimilarity(embedding, chunk.embedding!),
        matchType: 'vector' as const,
      }))
      .filter(r => r.score > 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
    
    return results;
  }
  
  async bm25Search(query: string, bookId: string, topK: number): Promise<SearchResult[]> {
    const terms = this.tokenize(query);
    const chunks = await this.db.getChunksByBook(bookId);
    
    const results = chunks.map(chunk => ({
      chunk,
      score: this.bm25Score(terms, chunk.content, chunks),
      matchType: 'bm25' as const,
    }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
    
    return results;
  }
  
  async search(query: SearchQuery): Promise<SearchResult[]> {
    return this.advancedSearch(query.query, query.bookId, {
      useReranking: true,
      useMultiQuery: true,
    });
  }
  
  // ... 工具方法
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
  
  private rrfFusion(
    vectorResults: SearchResult[],
    bm25Results: SearchResult[],
    topK: number,
    k: number = 60
  ): SearchResult[] {
    const scores = new Map<string, number>();
    
    vectorResults.forEach((r, i) => {
      scores.set(r.chunk.id, (scores.get(r.chunk.id) || 0) + 1 / (k + i + 1));
    });
    
    bm25Results.forEach((r, i) => {
      scores.set(r.chunk.id, (scores.get(r.chunk.id) || 0) + 1 / (k + i + 1));
    });
    
    const allChunks = new Map<string, SearchResult>();
    [...vectorResults, ...bm25Results].forEach(r => {
      allChunks.set(r.chunk.id, r);
    });
    
    return Array.from(scores.entries())
      .map(([id, score]) => ({
        ...allChunks.get(id)!,
        score,
        matchType: 'hybrid' as const,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
  
  private tokenize(text: string): string[] {
    return text.toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fff]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 0);
  }
  
  private bm25Score(terms: string[], doc: string, allDocs: Chunk[]): number {
    const k1 = 1.5, b = 0.75;
    const avgdl = allDocs.reduce((sum, c) => sum + c.tokenCount, 0) / allDocs.length;
    const docTokens = this.tokenize(doc);
    const docLen = docTokens.length;
    
    let score = 0;
    for (const term of terms) {
      const tf = docTokens.filter(t => t === term).length;
      const df = allDocs.filter(c => this.tokenize(c.content).includes(term)).length;
      const idf = Math.log((allDocs.length - df + 0.5) / (df + 0.5) + 1);
      score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / avgdl)));
    }
    
    return score;
  }
}
```

#### 3.2 实现 AI 工具

```typescript
// src/lib/ai/tools.ts 完整实现

import { RAGSearchPipeline } from '@/lib/rag/search-pipeline';
import type { Skill, Chunk, SearchResult } from '@/types';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export class RAGTools {
  private searchPipeline: RAGSearchPipeline;
  private bookId: string;
  
  constructor(searchPipeline: RAGSearchPipeline, bookId: string) {
    this.searchPipeline = searchPipeline;
    this.bookId = bookId;
  }
  
  getTools(): ToolDefinition[] {
    return [
      this.ragSearchTool(),
      this.ragTocTool(),
      this.ragContextTool(),
    ];
  }
  
  private ragSearchTool(): ToolDefinition {
    return {
      name: 'ragSearch',
      description: 'Search book content using semantic or keyword search. Use this when the user asks about specific content, themes, or topics in the book.',
      parameters: {
        query: {
          type: 'string',
          description: 'The search query describing what to find',
          required: true,
        },
        mode: {
          type: 'string',
          description: 'Search mode: "hybrid" (recommended), "vector" (semantic), or "bm25" (keyword)',
          required: false,
        },
        topK: {
          type: 'number',
          description: 'Number of results to return (default: 5)',
          required: false,
        },
      },
      execute: async (args) => {
        const query = args.query as string;
        const mode = (args.mode as 'hybrid' | 'vector' | 'bm25') || 'hybrid';
        const topK = (args.topK as number) || 5;
        
        const results = await this.searchPipeline.search({
          query,
          bookId: this.bookId,
          mode,
          topK,
          threshold: 0.3,
        });
        
        return {
          results: results.map(r => ({
            chapter: r.chunk.chapterTitle,
            content: r.chunk.content,
            score: r.score,
            matchType: r.matchType,
          })),
        };
      },
    };
  }
  
  private ragTocTool(): ToolDefinition {
    return {
      name: 'ragToc',
      description: 'Get the table of contents of the current book. Use this when the user wants to see the book structure or navigate to a specific chapter.',
      parameters: {},
      execute: async () => {
        // TODO: 从书籍元数据获取目录
        return {
          chapters: [],
          message: 'Table of contents retrieved',
        };
      },
    };
  }
  
  private ragContextTool(): ToolDefinition {
    return {
      name: 'ragContext',
      description: 'Get surrounding text context for a specific position. Use this when the user asks about content near a specific location.',
      parameters: {
        chapterIndex: {
          type: 'number',
          description: 'The chapter index',
          required: true,
        },
        range: {
          type: 'number',
          description: 'Number of chunks to include before and after (default: 2)',
          required: false,
        },
      },
      execute: async (args) => {
        const chapterIndex = args.chapterIndex as number;
        const range = (args.range as number) || 2;
        
        // TODO: 获取指定章节周围的 chunks
        return {
          context: '',
          message: 'Context retrieved',
        };
      },
    };
  }
}

/** Get available tools based on current state */
export function getAvailableTools(options: {
  searchPipeline: RAGSearchPipeline;
  bookId: string | null;
  isVectorized: boolean;
  enabledSkills: Skill[];
}): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  
  // 只有在书籍已向量化时才添加 RAG 工具
  if (options.isVectorized && options.bookId) {
    const ragTools = new RAGTools(options.searchPipeline, options.bookId);
    tools.push(...ragTools.getTools());
  }
  
  // 添加自定义技能
  for (const skill of options.enabledSkills) {
    tools.push(skillToTool(skill));
  }
  
  return tools;
}

function skillToTool(skill: Skill): ToolDefinition {
  const parameters: Record<string, ToolParameter> = {};
  for (const param of skill.parameters) {
    parameters[param.name] = {
      type: param.type,
      description: param.description,
      required: param.required,
    };
  }
  
  return {
    name: skill.name,
    description: skill.description,
    parameters,
    execute: async (args) => {
      // 技能执行逻辑
      return { result: 'Skill executed', args };
    },
  };
}
```

---

### 4. 向量化管道

**现状**: chunker 完成，embedding 生成未实现。

**技术方案**:

> 📚 **核心增强: Contextual Retrieval**
>
> 在向量化阶段为每个 chunk 添加文档上下文，解决分块后语义丢失问题。
> - 检索失败率降低 49%
> - 成本: $1.02 / 百万 token (Prompt Caching)

#### 4.1 Embedding 服务

```typescript
// src/lib/rag/embedding-service.ts

export interface EmbeddingConfig {
  provider: 'openai' | 'voyage' | 'gemini' | 'local';
  model: string;
  apiKey?: string;
  baseUrl?: string;
  batchSize: number;
}

/**
 * 推荐模型 (2024-2025):
 * - OpenAI: text-embedding-3-small (性价比), text-embedding-3-large (精度)
 * - Voyage: voyage-3 (Anthropic 推荐)
 * - Gemini: text-embedding-004 (高性价比)
 */
export class EmbeddingService {
  private config: EmbeddingConfig;
  
  constructor(config: EmbeddingConfig) {
    this.config = config;
  }
  
  async embed(text: string): Promise<number[]> {
    if (this.config.provider === 'openai') {
      return this.embedWithOpenAI([text]).then(r => r[0]);
    }
    throw new Error(`Unsupported provider: ${this.config.provider}`);
  }
  
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (this.config.provider === 'openai') {
      return this.embedWithOpenAI(texts);
    }
    throw new Error(`Unsupported provider: ${this.config.provider}`);
  }
  
  private async embedWithOpenAI(texts: string[]): Promise<number[][]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model || 'text-embedding-3-small',
        input: texts,
      }),
    });
    
    const data = await response.json();
    return data.data
      .sort((a: any, b: any) => a.index - b.index)
      .map((d: any) => d.embedding);
  }
}
```

#### 4.2 增强型向量化管道

```typescript
// src/lib/rag/vectorize-pipeline.ts

import { chunkContent } from './chunker';
import { EmbeddingService } from './embedding-service';
import { ContextualRetrieval } from './contextual-retrieval';
import type { Chunk, VectorizeProgress } from '@/types';
import type { Database } from '@/lib/db/database';

export interface VectorizeOptions {
  bookId: string;
  content: string;
  chapterTitle: string;
  enableContextualRetrieval?: boolean; // 是否启用上下文增强
  onProgress?: (progress: VectorizeProgress) => void;
}

/**
 * 增强型向量化管道
 * 支持 Contextual Retrieval
 */
export class VectorizePipeline {
  private db: Database;
  private embeddingService: EmbeddingService;
  private contextualRetrieval: ContextualRetrieval;
  
  constructor(
    db: Database,
    embeddingService: EmbeddingService,
    llmService: LLMService
  ) {
    this.db = db;
    this.embeddingService = embeddingService;
    this.contextualRetrieval = new ContextualRetrieval(llmService);
  }
  
  async vectorize(options: VectorizeOptions): Promise<Chunk[]> {
    const { 
      bookId, 
      content, 
      chapterTitle, 
      enableContextualRetrieval = true,
      onProgress 
    } = options;
    
    // 1. 分块
    onProgress?.({
      bookId,
      totalChunks: 0,
      processedChunks: 0,
      status: 'chunking',
    });
    
    const chunks = chunkContent(content, bookId, 0, chapterTitle);
    
    // 2. Contextual Retrieval (可选)
    let textsToEmbed: string[];
    
    if (enableContextualRetrieval) {
      onProgress?.({
        bookId,
        totalChunks: chunks.length,
        processedChunks: 0,
        status: 'contextualizing', // 新状态
      });
      
      textsToEmbed = [];
      
      for (let i = 0; i < chunks.length; i++) {
        const { contextualizedChunk, context } = 
          await this.contextualRetrieval.contextualizeChunk(content, chunks[i].content);
        
        textsToEmbed.push(contextualizedChunk);
        chunks[i].context = context; // 存储上下文用于调试/展示
        
        onProgress?.({
          bookId,
          totalChunks: chunks.length,
          processedChunks: i + 1,
          status: 'contextualizing',
        });
      }
    } else {
      textsToEmbed = chunks.map(c => c.content);
    }
    
    // 3. 生成 embedding (批量处理)
    onProgress?.({
      bookId,
      totalChunks: chunks.length,
      processedChunks: 0,
      status: 'embedding',
    });
    
    const batchSize = 20;
    const embeddings: number[][] = [];
    
    for (let i = 0; i < textsToEmbed.length; i += batchSize) {
      const batch = textsToEmbed.slice(i, i + batchSize);
      const batchEmbeddings = await this.embeddingService.embedBatch(batch);
      embeddings.push(...batchEmbeddings);
      
      onProgress?.({
        bookId,
        totalChunks: chunks.length,
        processedChunks: Math.min(i + batchSize, chunks.length),
        status: 'embedding',
      });
    }
    
    // 4. 存储到数据库
    onProgress?.({
      bookId,
      totalChunks: chunks.length,
      processedChunks: chunks.length,
      status: 'indexing',
    });
    
    const chunksWithEmbedding = chunks.map((chunk, i) => ({
      ...chunk,
      embedding: embeddings[i],
    }));
    
    await this.db.insertChunks(chunksWithEmbedding);
    
    // 5. 同时构建 BM25 索引
    await this.buildBM25Index(chunksWithEmbedding);
    
    onProgress?.({
      bookId,
      totalChunks: chunks.length,
      processedChunks: chunks.length,
      status: 'completed',
    });
    
    return chunksWithEmbedding;
  }
  
  private async buildBM25Index(chunks: Chunk[]): Promise<void> {
    // BM25 可以在查询时动态计算，无需预构建
    // 但可以预处理 token 以加速
  }
}
```

#### 4.3 类型扩展

```typescript
// src/types/rag.ts 扩展

export interface Chunk {
  id: string;
  bookId: string;
  chapterIndex: number;
  chapterTitle: string;
  content: string;
  tokenCount: number;
  startCfi: string;
  endCfi: string;
  embedding?: number[];
  context?: string;  // 新增: LLM 生成的上下文
}

export interface VectorizeProgress {
  bookId: string;
  totalChunks: number;
  processedChunks: number;
  status: 'idle' | 'chunking' | 'contextualizing' | 'embedding' | 'indexing' | 'completed' | 'error';
  error?: string;
}
```

#### 4.4 性能对比

| 配置 | 检索失败率 | 成本/百万token | 延迟 |
|------|-----------|---------------|------|
| 标准分块 + Embedding | ~6% | $0.02 | 低 |
| + Contextual Retrieval | ~3% (↓49%) | +$1.02 | 中 |
| + Reranking | ~2% (↓67%) | +$0.50/1K查询 | 高 |

**推荐配置**:
- **开发/测试**: 标准分块即可
- **生产环境**: Contextual Retrieval + Reranking
```

#### 4.3 数据库扩展

```typescript
// src/lib/db/database.ts 扩展

export class Database {
  // ... 现有方法
  
  async getChunksByBook(bookId: string): Promise<Chunk[]> {
    const results = await this.db.select<{
      id: string;
      book_id: string;
      chapter_index: number;
      chapter_title: string;
      content: string;
      token_count: number;
      start_cfi: string;
      end_cfi: string;
      embedding: Uint8Array;
    }>(
      'SELECT * FROM chunks WHERE book_id = ? ORDER BY chapter_index, id',
      [bookId]
    );
    
    return results.map(r => ({
      id: r.id,
      bookId: r.book_id,
      chapterIndex: r.chapter_index,
      chapterTitle: r.chapter_title,
      content: r.content,
      tokenCount: r.token_count,
      startCfi: r.start_cfi,
      endCfi: r.end_cfi,
      embedding: this.deserializeEmbedding(r.embedding),
    }));
  }
  
  async insertChunks(chunks: Chunk[]): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO chunks (id, book_id, chapter_index, chapter_title, content, token_count, start_cfi, end_cfi, embedding)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    for (const chunk of chunks) {
      stmt.run([
        chunk.id,
        chunk.bookId,
        chunk.chapterIndex,
        chunk.chapterTitle,
        chunk.content,
        chunk.tokenCount,
        chunk.startCfi,
        chunk.endCfi,
        this.serializeEmbedding(chunk.embedding),
      ]);
    }
  }
  
  private serializeEmbedding(embedding: number[] | undefined): Uint8Array {
    if (!embedding) return new Uint8Array(0);
    const buffer = new ArrayBuffer(embedding.length * 4);
    const view = new Float32Array(buffer);
    embedding.forEach((v, i) => view[i] = v);
    return new Uint8Array(buffer);
  }
  
  private deserializeEmbedding(data: Uint8Array): number[] | undefined {
    if (data.length === 0) return undefined;
    const view = new Float32Array(data.buffer);
    return Array.from(view);
  }
}
```

---

## P1 - 重要功能增强

### 5. 批注导出功能

**现状**: 批注存储完成，无导出功能。

**技术方案**:

```typescript
// src/lib/export/annotation-exporter.ts

export interface ExportOptions {
  format: 'markdown' | 'json' | 'notion' | 'obsidian';
  includeNotes: boolean;
  includeHighlights: boolean;
  groupByChapter: boolean;
}

export class AnnotationExporter {
  
  async exportHighlights(
    highlights: Highlight[],
    notes: Note[],
    book: Book,
    options: ExportOptions
  ): Promise<string> {
    switch (options.format) {
      case 'markdown':
        return this.toMarkdown(highlights, notes, book, options);
      case 'json':
        return this.toJSON(highlights, notes, book);
      case 'notion':
        return this.toNotion(highlights, notes, book, options);
      case 'obsidian':
        return this.toObsidian(highlights, notes, book, options);
      default:
        throw new Error(`Unsupported format: ${options.format}`);
    }
  }
  
  private toMarkdown(
    highlights: Highlight[],
    notes: Note[],
    book: Book,
    options: ExportOptions
  ): string {
    let md = `# ${book.meta.title}\n\n`;
    md += `作者: ${book.meta.author}\n\n`;
    md += `---\n\n`;
    
    if (options.groupByChapter) {
      const grouped = this.groupByChapter(highlights);
      for (const [chapter, chapterHighlights] of grouped) {
        md += `## ${chapter}\n\n`;
        for (const h of chapterHighlights) {
          md += `> ${h.text}\n`;
          if (h.note) {
            md += `\n💡 ${h.note}\n`;
          }
          md += '\n';
        }
      }
    } else {
      for (const h of highlights) {
        md += `> ${h.text}\n`;
        if (h.chapterTitle) {
          md += `> — *${h.chapterTitle}*\n`;
        }
        if (h.note) {
          md += `\n💡 ${h.note}\n`;
        }
        md += '\n---\n\n';
      }
    }
    
    return md;
  }
  
  private toJSON(highlights: Highlight[], notes: Note[], book: Book): string {
    return JSON.stringify({
      book: {
        id: book.id,
        title: book.meta.title,
        author: book.meta.author,
      },
      exportedAt: new Date().toISOString(),
      highlights,
      notes,
    }, null, 2);
  }
  
  private toObsidian(
    highlights: Highlight[],
    notes: Note[],
    book: Book,
    options: ExportOptions
  ): string {
    let md = `---
title: "${book.meta.title}"
author: "${book.meta.author}"
type: book-notes
created: ${new Date().toISOString()}
tags:
  - book
  - reading-notes
---

# ${book.meta.title}

## 元信息
- 作者: [[${book.meta.author}]]
- 导出时间: ${new Date().toLocaleDateString()}

---

## 高亮与笔记

`;
    
    const grouped = this.groupByChapter(highlights);
    for (const [chapter, chapterHighlights] of grouped) {
      md += `### ${chapter}\n\n`;
      for (const h of chapterHighlights) {
        md += `> [!quote] 高亮\n`;
        md += `> ${h.text}\n`;
        if (h.note) {
          md += `\n**笔记**: ${h.note}\n`;
        }
        md += '\n';
      }
    }
    
    return md;
  }
  
  private toNotion(
    highlights: Highlight[],
    notes: Note[],
    book: Book,
    options: ExportOptions
  ): string {
    // Notion 格式 (用于粘贴到 Notion)
    let md = `# ${book.meta.title}\n\n`;
    
    for (const h of highlights) {
      md += `**${h.chapterTitle || '未知章节'}**\n`;
      md += `> ${h.text}\n`;
      if (h.note) {
        md += `\n💭 ${h.note}\n`;
      }
      md += '\n---\n\n';
    }
    
    return md;
  }
  
  private groupByChapter(highlights: Highlight[]): Map<string, Highlight[]> {
    const grouped = new Map<string, Highlight[]>();
    for (const h of highlights) {
      const chapter = h.chapterTitle || '未知章节';
      if (!grouped.has(chapter)) {
        grouped.set(chapter, []);
      }
      grouped.get(chapter)!.push(h);
    }
    return grouped;
  }
  
  async exportToFile(content: string, filename: string): Promise<void> {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}
```

---

### 6. AI 流式输出

**现状**: 消息管道完成，流式未实现。

**技术方案**:

```typescript
// src/lib/ai/streaming.ts

import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';

export interface StreamingOptions {
  model: string;
  apiKey: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  systemPrompt: string;
  onToken: (token: string) => void;
  onComplete: (fullText: string) => void;
  onError: (error: Error) => void;
}

export class StreamingChat {
  private abortController: AbortController | null = null;
  
  async stream(options: StreamingOptions): Promise<void> {
    this.abortController = new AbortController();
    
    try {
      const result = streamText({
        model: openai(options.model, {
          apiKey: options.apiKey,
        }),
        system: options.systemPrompt,
        messages: options.messages,
        abortSignal: this.abortController.signal,
      });
      
      let fullText = '';
      
      for await (const textPart of result.textStream) {
        fullText += textPart;
        options.onToken(textPart);
      }
      
      options.onComplete(fullText);
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        // 用户取消
        return;
      }
      options.onError(error as Error);
    }
  }
  
  abort(): void {
    this.abortController?.abort();
  }
}
```

#### React Hook 集成

```typescript
// src/hooks/use-streaming-chat.ts

import { useState, useCallback, useRef } from 'react';
import { StreamingChat } from '@/lib/ai/streaming';

export function useStreamingChat() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const streamingRef = useRef<StreamingChat | null>(null);
  
  const startStream = useCallback(async (options: Omit<StreamingOptions, 'onToken' | 'onComplete' | 'onError'>) => {
    setIsStreaming(true);
    setStreamingText('');
    setError(null);
    
    streamingRef.current = new StreamingChat();
    
    await streamingRef.current.stream({
      ...options,
      onToken: (token) => {
        setStreamingText(prev => prev + token);
      },
      onComplete: () => {
        setIsStreaming(false);
      },
      onError: (err) => {
        setError(err);
        setIsStreaming(false);
      },
    });
  }, []);
  
  const stopStream = useCallback(() => {
    streamingRef.current?.abort();
    setIsStreaming(false);
  }, []);
  
  return {
    isStreaming,
    streamingText,
    error,
    startStream,
    stopStream,
  };
}
```

---

### 7. 划词翻译

**现状**: 接口定义，实现为空。

**技术方案**:

```typescript
// src/lib/translation/translator.ts 完整实现

export type TranslationProvider = 'google' | 'deepl' | 'openai';

export interface TranslationConfig {
  provider: TranslationProvider;
  apiKey?: string;
  targetLang: TranslationTargetLang;
}

export class Translator {
  private config: TranslationConfig;
  
  constructor(config: TranslationConfig) {
    this.config = config;
  }
  
  async translate(text: string): Promise<TranslationResult> {
    switch (this.config.provider) {
      case 'openai':
        return this.translateWithOpenAI(text);
      case 'deepl':
        return this.translateWithDeepL(text);
      default:
        throw new Error(`Unsupported provider: ${this.config.provider}`);
    }
  }
  
  private async translateWithOpenAI(text: string): Promise<TranslationResult> {
    const targetLangName = SUPPORTED_LANGUAGES.find(l => l.code === this.config.targetLang)?.name || this.config.targetLang;
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a professional translator. Translate the following text to ${targetLangName}. Only output the translation, no explanations.`,
          },
          {
            role: 'user',
            content: text,
          },
        ],
      }),
    });
    
    const data = await response.json();
    const translatedText = data.choices[0].message.content;
    
    return {
      originalText: text,
      translatedText,
      targetLang: this.config.targetLang,
    };
  }
  
  private async translateWithDeepL(text: string): Promise<TranslationResult> {
    const response = await fetch('https://api-free.deepl.com/v2/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `DeepL-Auth-Key ${this.config.apiKey}`,
      },
      body: new URLSearchParams({
        text,
        target_lang: this.config.targetLang.toUpperCase(),
      }),
    });
    
    const data = await response.json();
    const translatedText = data.translations[0].text;
    
    return {
      originalText: text,
      translatedText,
      targetLang: this.config.targetLang,
    };
  }
}
```

#### 划词翻译 UI

```typescript
// src/components/reader/TranslationPopover.tsx

import { useState, useEffect } from 'react';
import { Translator } from '@/lib/translation/translator';
import { useSettingsStore } from '@/stores/settings-store';

interface Props {
  text: string;
  position: { x: number; y: number };
  onClose: () => void;
}

export function TranslationPopover({ text, position, onClose }: Props) {
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const settings = useSettingsStore(s => s.translation);
  
  useEffect(() => {
    const translator = new Translator({
      provider: settings.provider,
      apiKey: settings.apiKey,
      targetLang: settings.targetLang,
    });
    
    translator.translate(text)
      .then(setResult)
      .finally(() => setLoading(false));
  }, [text, settings]);
  
  return (
    <div
      className="absolute z-50 w-80 rounded-lg border bg-popover p-3 shadow-lg"
      style={{ left: position.x, top: position.y }}
    >
      <div className="mb-2 text-sm text-muted-foreground">原文</div>
      <div className="mb-3 text-sm">{text}</div>
      
      <div className="border-t pt-3">
        <div className="mb-1 text-sm text-muted-foreground">译文</div>
        {loading ? (
          <div className="animate-pulse text-sm">翻译中...</div>
        ) : (
          <div className="text-sm">{result?.translatedText}</div>
        )}
      </div>
      
      <button onClick={onClose} className="mt-3 text-xs text-muted-foreground">
        关闭
      </button>
    </div>
  );
}
```

---

### 8. 阅读统计可视化

**现状**: `reading_sessions` 表存在，无 UI。

**技术方案**:

```typescript
// src/lib/stats/reading-stats.ts

export interface DailyStats {
  date: string;
  totalTime: number; // 分钟
  pagesRead: number;
  booksCount: number;
}

export interface BookStats {
  bookId: string;
  bookTitle: string;
  totalTime: number;
  sessions: number;
  avgSessionTime: number;
  pagesRead: number;
}

export class ReadingStatsService {
  private db: Database;
  
  constructor(db: Database) {
    this.db = db;
  }
  
  async getDailyStats(startDate: Date, endDate: Date): Promise<DailyStats[]> {
    const sessions = await this.db.getReadingSessions(startDate, endDate);
    
    const grouped = new Map<string, DailyStats>();
    
    for (const session of sessions) {
      const date = new Date(session.startedAt).toISOString().split('T')[0];
      const existing = grouped.get(date) || {
        date,
        totalTime: 0,
        pagesRead: 0,
        booksCount: 0,
      };
      
      existing.totalTime += session.totalActiveTime / 60000; // 转换为分钟
      existing.pagesRead += session.pagesRead;
      existing.booksCount += 1;
      
      grouped.set(date, existing);
    }
    
    return Array.from(grouped.values()).sort((a, b) => a.date.localeCompare(b.date));
  }
  
  async getBookStats(bookId: string): Promise<BookStats> {
    const sessions = await this.db.getReadingSessionsByBook(bookId);
    const book = await this.db.getBook(bookId);
    
    const totalTime = sessions.reduce((sum, s) => sum + s.totalActiveTime, 0);
    
    return {
      bookId,
      bookTitle: book.meta.title,
      totalTime: totalTime / 60000,
      sessions: sessions.length,
      avgSessionTime: sessions.length > 0 ? (totalTime / sessions.length) / 60000 : 0,
      pagesRead: sessions.reduce((sum, s) => sum + s.pagesRead, 0),
    };
  }
  
  async getOverallStats(): Promise<{
    totalBooks: number;
    totalReadingTime: number;
    totalSessions: number;
    avgDailyTime: number;
    longestStreak: number;
    currentStreak: number;
  }> {
    // 实现统计逻辑
    // ...
    return {
      totalBooks: 0,
      totalReadingTime: 0,
      totalSessions: 0,
      avgDailyTime: 0,
      longestStreak: 0,
      currentStreak: 0,
    };
  }
}
```

#### 统计图表组件

```typescript
// src/components/stats/ReadingChart.tsx

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface Props {
  data: DailyStats[];
}

export function ReadingTimeChart({ data }: Props) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data}>
        <XAxis 
          dataKey="date" 
          tickFormatter={(d) => new Date(d).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
        />
        <YAxis 
          tickFormatter={(v) => `${v}分钟`}
        />
        <Tooltip 
          formatter={(value: number) => [`${value.toFixed(1)} 分钟`, '阅读时间']}
          labelFormatter={(label) => new Date(label).toLocaleDateString('zh-CN')}
        />
        <Line 
          type="monotone" 
          dataKey="totalTime" 
          stroke="hsl(var(--primary))" 
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
```

---

## P2 - 体验优化

### 9. 云同步功能

**现状**: 框架代码存在，逻辑为空。

**技术方案**:

#### 9.1 同步架构

```
┌─────────────────┐     ┌─────────────────┐
│   本地数据       │     │   云端数据       │
│   (SQLite)      │     │   (云存储)       │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     │
              ┌──────┴──────┐
              │  Sync Engine │
              │  (CRDT/Last-Write-Wins)
              └─────────────┘
```

#### 9.2 同步实现

```typescript
// src/lib/sync/sync-engine.ts

export interface SyncRecord {
  id: string;
  table: string;
  action: 'create' | 'update' | 'delete';
  data: any;
  timestamp: number;
  deviceId: string;
}

export class SyncEngine {
  private db: Database;
  private cloudStorage: CloudStorage;
  private deviceId: string;
  
  constructor(db: Database, cloudStorage: CloudStorage) {
    this.db = db;
    this.cloudStorage = cloudStorage;
    this.deviceId = this.getOrCreateDeviceId();
  }
  
  async sync(): Promise<void> {
    // 1. 获取本地变更
    const localChanges = await this.getLocalChanges();
    
    // 2. 获取云端变更
    const serverChanges = await this.cloudStorage.getChanges(
      await this.getLastSyncTimestamp()
    );
    
    // 3. 合并变更 (Last-Write-Wins)
    const merged = this.mergeChanges(localChanges, serverChanges);
    
    // 4. 应用变更
    await this.applyChanges(merged.toApplyLocal);
    await this.cloudStorage.pushChanges(merged.toPushServer);
    
    // 5. 更新同步时间戳
    await this.updateLastSyncTimestamp();
  }
  
  private mergeChanges(
    local: SyncRecord[],
    server: SyncRecord[]
  ): { toApplyLocal: SyncRecord[]; toPushServer: SyncRecord[] } {
    const toApplyLocal: SyncRecord[] = [];
    const toPushServer: SyncRecord[] = [];
    
    // 按 id 分组
    const grouped = new Map<string, { local?: SyncRecord; server?: SyncRecord }>();
    
    for (const record of local) {
      grouped.set(record.id, { ...grouped.get(record.id), local: record });
    }
    for (const record of server) {
      grouped.set(record.id, { ...grouped.get(record.id), server: record });
    }
    
    // 解决冲突
    for (const [id, { local, server }] of grouped) {
      if (!local && server) {
        // 只有服务端变更，应用到本地
        toApplyLocal.push(server);
      } else if (local && !server) {
        // 只有本地变更，推送到服务端
        toPushServer.push(local);
      } else if (local && server) {
        // 都有变更，按时间戳解决
        if (server.timestamp > local.timestamp) {
          toApplyLocal.push(server);
        } else {
          toPushServer.push(local);
        }
      }
    }
    
    return { toApplyLocal, toPushServer };
  }
  
  private async applyChanges(changes: SyncRecord[]): Promise<void> {
    for (const change of changes) {
      switch (change.action) {
        case 'create':
        case 'update':
          await this.db.upsert(change.table, change.data);
          break;
        case 'delete':
          await this.db.delete(change.table, change.id);
          break;
      }
    }
  }
}
```

#### 9.3 云存储选项

| 方案 | 优点 | 缺点 |
|------|------|------|
| iCloud (iOS/macOS) | 原生体验 | 仅 Apple 生态 |
| Dropbox API | 跨平台 | 需用户配置 |
| 自建服务器 | 完全控制 | 维护成本 |
| Supabase | 开源 + 托管 | 依赖第三方 |

---

### 10. 多格式支持

**技术方案**:

#### 10.1 格式转换管道

```typescript
// src/lib/reader/format-converter.ts

export class FormatConverter {
  
  // MOBI -> EPUB
  async mobiToEpub(file: Blob): Promise<Blob> {
    // 使用 Calibre CLI (需要用户安装)
    // 或使用 mobi.js 解析后重新打包
    throw new Error('Not implemented');
  }
  
  // TXT -> 结构化内容
  async txtToContent(text: string): Promise<{
    sections: { title: string; content: string }[];
  }> {
    // 自动检测章节分隔符
    const patterns = [
      /^第[一二三四五六七八九十百千万零\d]+[章节回][\s\S]*$/gm,
      /^Chapter\s+\d+.*$/gim,
      /^[篇章节]\s+.+$/gm,
    ];
    
    for (const pattern of patterns) {
      const matches = [...text.matchAll(pattern)];
      if (matches.length > 3) {
        // 找到章节分隔
        const sections: { title: string; content: string }[] = [];
        for (let i = 0; i < matches.length; i++) {
          const start = matches[i].index! + matches[i][0].length;
          const end = matches[i + 1]?.index ?? text.length;
          sections.push({
            title: matches[i][0].trim(),
            content: text.slice(start, end).trim(),
          });
        }
        return { sections };
      }
    }
    
    // 无章节分隔，作为单章处理
    return { sections: [{ title: '全文', content: text }] };
  }
  
  // DOCX -> HTML
  async docxToHtml(file: Blob): Promise<string> {
    // 使用 mammoth.js
    const mammoth = await import('mammoth');
    const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
    return result.value;
  }
}
```

#### 10.2 统一文件处理器

```typescript
// src/lib/reader/file-handler.ts

export type SupportedFormat = 'epub' | 'pdf' | 'mobi' | 'txt' | 'docx' | 'cbz';

export class FileHandler {
  private formatConverter: FormatConverter;
  
  async detectFormat(file: File): Promise<SupportedFormat> {
    const ext = file.name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'epub': return 'epub';
      case 'pdf': return 'pdf';
      case 'mobi':
      case 'azw':
      case 'azw3': return 'mobi';
      case 'txt': return 'txt';
      case 'docx': return 'docx';
      case 'cbz':
      case 'cbr': return 'cbz';
      default:
        throw new Error(`Unsupported format: ${ext}`);
    }
  }
  
  async prepareForReading(file: File): Promise<{
    format: SupportedFormat;
    content: Blob | string;
    meta: BookMeta;
  }> {
    const format = await this.detectFormat(file);
    
    switch (format) {
      case 'epub':
      case 'pdf':
        return { format, content: file, meta: await this.extractMeta(file, format) };
      case 'txt':
        const text = await file.text();
        const structured = await this.formatConverter.txtToContent(text);
        return { format, content: JSON.stringify(structured), meta: { title: file.name } };
      case 'docx':
        const html = await this.formatConverter.docxToHtml(file);
        return { format, content: html, meta: { title: file.name } };
      default:
        throw new Error(`Format ${format} not yet supported`);
    }
  }
}
```

---

### 11. TTS 朗读

**技术方案**:

```typescript
// src/lib/tts/tts-service.ts

export interface TTSOptions {
  voice: string;
  rate: number; // 0.5 - 2
  pitch: number; // 0 - 2
  volume: number; // 0 - 1
}

export class TTSService {
  private synth: SpeechSynthesis;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private isPlaying: boolean = false;
  
  constructor() {
    this.synth = window.speechSynthesis;
  }
  
  getVoices(): SpeechSynthesisVoice[] {
    return this.synth.getVoices();
  }
  
  speak(text: string, options: TTSOptions, onEnd?: () => void): void {
    this.stop();
    
    this.currentUtterance = new SpeechSynthesisUtterance(text);
    this.currentUtterance.voice = this.synth.getVoices().find(v => v.name === options.voice) || null;
    this.currentUtterance.rate = options.rate;
    this.currentUtterance.pitch = options.pitch;
    this.currentUtterance.volume = options.volume;
    
    this.currentUtterance.onend = () => {
      this.isPlaying = false;
      onEnd?.();
    };
    
    this.synth.speak(this.currentUtterance);
    this.isPlaying = true;
  }
  
  pause(): void {
    this.synth.pause();
  }
  
  resume(): void {
    this.synth.resume();
  }
  
  stop(): void {
    this.synth.cancel();
    this.isPlaying = false;
  }
  
  getIsPlaying(): boolean {
    return this.isPlaying;
  }
}
```

#### 高级 TTS (Edge TTS)

```typescript
// 使用 Edge TTS 获得更自然的语音
// src/lib/tts/edge-tts.ts

export class EdgeTTSService {
  async speak(text: string, voice: string = 'zh-CN-XiaoxiaoNeural'): Promise<void> {
    // 使用 WebSocket 连接 Edge TTS 服务
    // 需要后端代理或使用第三方库
    const response = await fetch('/api/tts', {
      method: 'POST',
      body: JSON.stringify({ text, voice }),
    });
    
    const audioBlob = await response.blob();
    const audio = new Audio(URL.createObjectURL(audioBlob));
    await audio.play();
  }
}
```

---

### 12. 阅读计划

**技术方案**:

```typescript
// src/lib/reading-plan/plan-service.ts

export interface ReadingPlan {
  id: string;
  bookId: string;
  dailyPages: number;
  dailyMinutes: number;
  startDate: number;
  targetDate: number;
  reminders: {
    enabled: boolean;
    time: string; // "HH:mm"
  };
}

export interface PlanProgress {
  planId: string;
  date: string;
  pagesRead: number;
  minutesRead: number;
  completed: boolean;
}

export class ReadingPlanService {
  private db: Database;
  
  async createPlan(plan: Omit<ReadingPlan, 'id'>): Promise<ReadingPlan> {
    const id = crypto.randomUUID();
    await this.db.insertPlan({ ...plan, id });
    return { ...plan, id };
  }
  
  async getTodayProgress(planId: string): Promise<PlanProgress> {
    const today = new Date().toISOString().split('T')[0];
    const progress = await this.db.getPlanProgress(planId, today);
    return progress || {
      planId,
      date: today,
      pagesRead: 0,
      minutesRead: 0,
      completed: false,
    };
  }
  
  async checkReminders(): Promise<void> {
    const plans = await this.db.getActivePlans();
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    
    for (const plan of plans) {
      if (plan.reminders.enabled && plan.reminders.time === currentTime) {
        const progress = await this.getTodayProgress(plan.id);
        if (!progress.completed) {
          await this.sendReminder(plan, progress);
        }
      }
    }
  }
  
  private async sendReminder(plan: ReadingPlan, progress: PlanProgress): Promise<void> {
    // 使用 Tauri 的通知 API
    const { sendNotification } = await import('@tauri-apps/plugin-notification');
    
    const book = await this.db.getBook(plan.bookId);
    const remaining = plan.dailyPages - progress.pagesRead;
    
    await sendNotification({
      title: '阅读提醒',
      body: `《${book.meta.title}》今日还需阅读 ${remaining} 页`,
    });
  }
}
```

---

## P3 - 创新功能

### 13. 知识图谱

**技术方案**:

```typescript
// src/lib/knowledge/graph-builder.ts

export interface KnowledgeNode {
  id: string;
  type: 'concept' | 'person' | 'place' | 'event' | 'theme';
  name: string;
  description?: string;
  sources: string[]; // chunk IDs
}

export interface KnowledgeEdge {
  id: string;
  source: string;
  target: string;
  type: 'related' | 'causes' | 'mentions' | 'contradicts';
  weight: number;
}

export class KnowledgeGraphBuilder {
  private ai: AIService;
  
  async extractEntities(chunks: Chunk[]): Promise<KnowledgeNode[]> {
    const nodes: KnowledgeNode[] = [];
    
    for (const chunk of chunks) {
      const prompt = `Extract entities from the following text. Return JSON array with objects: { "type": "concept|person|place|event|theme", "name": "...", "description": "..." }

Text:
${chunk.content}`;
      
      const entities = await this.ai.complete(prompt);
      const parsed = JSON.parse(entities);
      
      for (const entity of parsed) {
        nodes.push({
          id: this.generateId(entity.name),
          type: entity.type,
          name: entity.name,
          description: entity.description,
          sources: [chunk.id],
        });
      }
    }
    
    return this.mergeNodes(nodes);
  }
  
  async extractRelations(nodes: KnowledgeNode[], chunks: Chunk[]): Promise<KnowledgeEdge[]> {
    const edges: KnowledgeEdge[] = [];
    
    // 找出同一 chunk 中出现的实体，建立关联
    for (const chunk of chunks) {
      const nodesInChunk = nodes.filter(n => n.sources.includes(chunk.id));
      
      for (let i = 0; i < nodesInChunk.length; i++) {
        for (let j = i + 1; j < nodesInChunk.length; j++) {
          const existing = edges.find(
            e => (e.source === nodesInChunk[i].id && e.target === nodesInChunk[j].id) ||
                 (e.source === nodesInChunk[j].id && e.target === nodesInChunk[i].id)
          );
          
          if (existing) {
            existing.weight += 1;
          } else {
            edges.push({
              id: crypto.randomUUID(),
              source: nodesInChunk[i].id,
              target: nodesInChunk[j].id,
              type: 'related',
              weight: 1,
            });
          }
        }
      }
    }
    
    return edges;
  }
  
  private mergeNodes(nodes: KnowledgeNode[]): KnowledgeNode[] {
    const merged = new Map<string, KnowledgeNode>();
    
    for (const node of nodes) {
      const existing = merged.get(node.id);
      if (existing) {
        existing.sources.push(...node.sources);
      } else {
        merged.set(node.id, { ...node });
      }
    }
    
    return Array.from(merged.values());
  }
  
  private generateId(name: string): string {
    return name.toLowerCase().replace(/\s+/g, '-');
  }
}
```

---

### 14. AI 共读模式

**技术方案**:

```typescript
// src/lib/ai/co-reading.ts

export interface CoReadingSession {
  bookId: string;
  phase: 'reading' | 'reflection' | 'discussion';
  currentChapter: number;
  questions: DiscussionQuestion[];
  insights: string[];
}

export interface DiscussionQuestion {
  id: string;
  question: string;
  type: 'comprehension' | 'analysis' | 'application' | 'synthesis';
  askedAt: number;
  answered: boolean;
}

export class CoReadingService {
  private ai: AIService;
  
  async generateQuestions(
    chapterContent: string,
    chapterIndex: number
  ): Promise<DiscussionQuestion[]> {
    const prompt = `You are a thoughtful reading companion. Based on this chapter content, generate 3 discussion questions at different levels:

1. Comprehension: Check understanding of key points
2. Analysis: Encourage deeper thinking about themes, characters
3. Application: Connect to real-world situations

Return JSON array: [{ "type": "comprehension|analysis|application", "question": "..." }]

Chapter content:
${chapterContent.slice(0, 2000)}`;

    const response = await this.ai.complete(prompt);
    const questions = JSON.parse(response);
    
    return questions.map((q: any, i: number) => ({
      id: `${chapterIndex}-${i}`,
      question: q.question,
      type: q.type,
      askedAt: Date.now(),
      answered: false,
    }));
  }
  
  async detectReadingMilestone(
    session: CoReadingSession,
    progress: number
  ): Promise<boolean> {
    // 在章节末尾触发讨论
    if (progress > 0.95 && session.phase === 'reading') {
      return true;
    }
    return false;
  }
  
  async startDiscussion(session: CoReadingSession): Promise<string> {
    const unansweredQuestions = session.questions.filter(q => !q.answered);
    
    if (unansweredQuestions.length === 0) {
      return "你已经完成了本章的讨论。是否继续下一章？";
    }
    
    const question = unansweredQuestions[0];
    session.phase = 'discussion';
    
    return `📖 让我们讨论一下：\n\n${question.question}`;
  }
  
  async respondToAnswer(
    session: CoReadingSession,
    questionId: string,
    userAnswer: string,
    chapterContent: string
  ): Promise<string> {
    const question = session.questions.find(q => q.id === questionId);
    if (!question) return "抱歉，我没找到这个问题。";
    
    const prompt = `The reader answered a discussion question. Provide a thoughtful response that:
1. Acknowledges their answer
2. Adds a new perspective or follow-up insight
3. Encourages further reflection

Question: ${question.question}
Reader's answer: ${userAnswer}

Chapter context: ${chapterContent.slice(0, 1000)}`;

    const response = await this.ai.complete(prompt);
    question.answered = true;
    
    return response;
  }
}
```

---

### 15. 间隔重复复习

**技术方案**:

```typescript
// src/lib/spaced-repetition/review-system.ts

export interface ReviewCard {
  id: string;
  highlightId: string;
  front: string; // 问题或提示
  back: string;  // 答案或原文
  interval: number; // 天
  easeFactor: number;
  repetitions: number;
  nextReview: number; // timestamp
  lastReview: number;
}

export class SpacedRepetitionService {
  private db: Database;
  
  async createCardsFromHighlights(highlights: Highlight[]): Promise<ReviewCard[]> {
    const cards: ReviewCard[] = [];
    
    for (const highlight of highlights) {
      if (highlight.note) {
        // 有笔记的高亮创建填空卡
        cards.push({
          id: crypto.randomUUID(),
          highlightId: highlight.id,
          front: highlight.text.slice(0, 20) + '...',
          back: highlight.text,
          interval: 1,
          easeFactor: 2.5,
          repetitions: 0,
          nextReview: Date.now(),
          lastReview: 0,
        });
      }
    }
    
    return cards;
  }
  
  async reviewCard(cardId: string, quality: 0 | 1 | 2 | 3 | 4 | 5): Promise<void> {
    // SM-2 算法
    const card = await this.db.getReviewCard(cardId);
    
    if (quality >= 3) {
      // 成功回忆
      if (card.repetitions === 0) {
        card.interval = 1;
      } else if (card.repetitions === 1) {
        card.interval = 6;
      } else {
        card.interval = Math.round(card.interval * card.easeFactor);
      }
      card.repetitions += 1;
    } else {
      // 失败
      card.repetitions = 0;
      card.interval = 1;
    }
    
    // 更新 ease factor
    card.easeFactor = Math.max(
      1.3,
      card.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    );
    
    card.lastReview = Date.now();
    card.nextReview = Date.now() + card.interval * 24 * 60 * 60 * 1000;
    
    await this.db.updateReviewCard(card);
  }
  
  async getDueCards(): Promise<ReviewCard[]> {
    const now = Date.now();
    return this.db.getReviewCardsDue(now);
  }
}
```

---

## 架构改进建议

### 1. 统一的渲染器抽象层

```typescript
// 所有渲染器实现统一接口
// src/lib/reader/renderer-factory.ts

export class RendererFactory {
  static create(format: SupportedFormat, container: HTMLElement): DocumentRenderer {
    switch (format) {
      case 'epub':
        return new EPUBRenderer();
      case 'pdf':
        return new PDFRenderer();
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }
}
```

### 2. 事件驱动的状态管理

```typescript
// 使用 Zustand + 事件总线
// src/lib/event-bus.ts

type EventMap = {
  'book:opened': { bookId: string };
  'book:closed': { bookId: string };
  'annotation:added': { annotation: Annotation };
  'annotation:removed': { id: string };
  'reading:progress': { bookId: string; progress: number };
  'sync:started': {};
  'sync:completed': {};
  'sync:error': { error: Error };
};

export class EventBus {
  private listeners = new Map<keyof EventMap, Set<Function>>();
  
  on<K extends keyof EventMap>(event: K, callback: (data: EventMap[K]) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }
  
  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    this.listeners.get(event)?.forEach(cb => cb(data));
  }
}
```

### 3. 插件系统架构

```typescript
// src/lib/plugin-system.ts

export interface Plugin {
  name: string;
  version: string;
  activate(context: PluginContext): Promise<void>;
  deactivate(): Promise<void>;
}

export interface PluginContext {
  db: Database;
  eventBus: EventBus;
  registerCommand(command: Command): void;
  registerSkill(skill: Skill): void;
  registerRenderer(format: string, renderer: typeof DocumentRenderer): void;
}

export class PluginManager {
  private plugins: Map<string, Plugin> = new Map();
  
  async loadPlugin(plugin: Plugin): Promise<void> {
    await plugin.activate(this.createContext(plugin));
    this.plugins.set(plugin.name, plugin);
  }
  
  async unloadPlugin(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (plugin) {
      await plugin.deactivate();
      this.plugins.delete(name);
    }
  }
}
```

---

## RAG 技术方案对比

### 业界最佳实践 (2024-2025)

| 技术 | 效果提升 | 实现成本 | 运行成本 | 推荐度 | 适用场景 |
|------|----------|----------|----------|--------|----------|
| **Contextual Retrieval** | ↓49% 失败率 | 低 | 低($1/百万token) | ⭐⭐⭐⭐⭐ | 所有场景 |
| **Reranking** | ↓18% 失败率 | 低 | 中($0.5/1K查询) | ⭐⭐⭐⭐⭐ | 高精度要求 |
| **HyDE** | ↑10-20% 召回 | 低 | 中(每次查询) | ⭐⭐⭐⭐ | 语义模糊查询 |
| **Multi-Query** | ↑15-25% 召回 | 低 | 中(每次查询) | ⭐⭐⭐⭐ | 复杂问题 |
| **Hybrid Search** | ↑20-30% | 低 | 低 | ⭐⭐⭐⭐⭐ | 必选基础 |
| **GraphRAG** | 复杂推理强 | 高 | 高(10x token) | ⭐⭐⭐ | 人物/知识关联 |

### 推荐实施路径

```
阶段 1: 基础能力 (1周)
├── Hybrid Search (Vector + BM25 + RRF)
└── Embedding Service

阶段 2: 召回增强 (1周)
├── Contextual Retrieval (预处理)
└── Multi-Query (运行时可选)

阶段 3: 精度优化 (可选)
└── Reranking (Cohere/Voyage)

阶段 4: 高级特性 (长期)
├── HyDE (语义模糊查询)
└── GraphRAG (知识图谱)
```

### 成本估算

| 配置 | 预处理成本/书 | 查询成本/次 |
|------|--------------|------------|
| 基础 Hybrid | $0.01 | $0.001 |
| + Contextual | $0.05 | $0.001 |
| + Reranking | $0.05 | $0.005 |
| + Multi-Query | $0.05 | $0.003 |

---

## 实施优先级总览

| 优先级 | 功能 | 预估工时 | 依赖 |
|--------|------|----------|------|
| **P0** | EPUB 渲染器 | 2 周 | foliate-js |
| **P0** | PDF 渲染器 | 2 周 | PDF.js |
| **P0** | RAG 基础管道 | 1 周 | Embedding API |
| **P0** | 向量化管道 + Contextual | 1 周 | LLM API |
| **P1** | Reranking 精排 | 3 天 | Cohere/Voyage API |
| **P1** | AI 流式输出 | 3 天 | AI SDK |
| **P1** | 批注导出 | 3 天 | 无 |
| **P1** | 划词翻译 | 3 天 | 翻译 API |
| **P1** | 阅读统计 | 1 周 | 图表库 |
| **P2** | Multi-Query / HyDE | 3 天 | LLM API |
| **P2** | 云同步 | 2 周 | 云存储 |
| **P2** | 多格式支持 | 1 周 | 格式转换 |
| **P2** | TTS 朗读 | 3 天 | Web Speech API |
| **P2** | 阅读计划 | 1 周 | 通知 API |
| **P3** | GraphRAG | 3 周 | AI 服务 + 图数据库 |
| **P3** | AI 共读 | 1 周 | AI 服务 |
| **P3** | 间隔重复 | 1 周 | 无 |

---

## 下一步行动

1. **立即开始**: EPUB 渲染器实现（核心功能）
2. **并行推进**: 向量化管道 + RAG 工具（含 Contextual Retrieval）
3. **快速迭代**: AI 流式输出 + 批注导出（用户可见价值高）
4. **中期优化**: Reranking + Multi-Query（提升检索精度）
5. **长期规划**: GraphRAG、云同步等创新功能

---

## 参考资料

### RAG 技术
- [Anthropic: Contextual Retrieval](https://www.anthropic.com/research/contextual-retrieval) - 上下文增强检索
- [Cohere: Reranking](https://cohere.com/rerank) - 精排服务
- [RAGFlow: RAG 2025 回顾](https://ragflow.io/blog/rag-review-2025-from-rag-to-context) - RAG 技术演进

### 渲染引擎
- [foliate-js](https://github.com/johnfactotum/foliate-js) - 多格式电子书渲染
- [PDF.js](https://github.com/nickmomrik/docs) - PDF 渲染

### 向量数据库
- [pgvector](https://github.com/pgvector/pgvector) - PostgreSQL 向量扩展
- [Chroma](https://www.trychroma.com/) - 轻量级向量数据库
- [Qdrant](https://qdrant.tech/) - 高性能向量数据库

---

*文档结束*
