# DocumentLoader 详细实现

## 1. 核心实现

基于 Readest 的 `libs/document.ts` 实现，适配我们的项目架构。

```typescript
// libs/document.ts

import { configureZip } from '@/utils/zip';
import * as epubcfi from 'foliate-js/epubcfi.js';

export const CFI = epubcfi;

// ==================== 类型定义 ====================

export type BookFormat = 'EPUB' | 'PDF' | 'MOBI' | 'AZW' | 'AZW3' | 'FB2' | 'FBZ' | 'CBZ' | 'TXT';

export interface BookMetadata {
  title: string | LanguageMap;
  author: string | Contributor;
  language: string | string[];
  editor?: string;
  publisher?: string;
  published?: string;
  description?: string;
  subject?: string | string[] | Contributor;
  identifier?: string;
  
  // 封面
  coverImageBlobUrl?: string;
}

export interface TOCItem {
  id: number;
  label: string;
  href: string;
  index: number;
  cfi?: string;
  subitems?: TOCItem[];
}

export interface Section {
  id: string;
  cfi: string;
  size: number;
  linear: 'yes' | 'no';
  href?: string;
  pageSpread?: 'left' | 'right' | 'center' | '';
  
  // 加载和卸载
  load(): Promise<string>;  // 返回 blob URL
  unload(): void;
  
  // 用于搜索
  createDocument?(): Promise<Document>;
}

export interface BookDoc {
  metadata: BookMetadata;
  rendition?: {
    layout?: 'pre-paginated' | 'reflowable';
    spread?: 'auto' | 'none' | 'both';
    viewport?: { width: number; height: number };
  };
  dir: 'ltr' | 'rtl';
  toc?: TOCItem[];
  sections: Section[];
  
  // 方法
  getCover(): Promise<Blob | null>;
  splitTOCHref(href: string): [string | number, string | number];
  getTOCFragment?(doc: Document, id: string | number): Node | null;
}

// ==================== 文件扩展名和 MIME 类型 ====================

export const EXTS: Record<BookFormat, string> = {
  EPUB: 'epub',
  PDF: 'pdf',
  MOBI: 'mobi',
  AZW: 'azw',
  AZW3: 'azw3',
  FB2: 'fb2',
  FBZ: 'fbz',
  CBZ: 'cbz',
  TXT: 'txt',
};

export const MIMETYPES: Record<BookFormat, string[]> = {
  EPUB: ['application/epub+zip'],
  PDF: ['application/pdf'],
  MOBI: ['application/x-mobipocket-ebook'],
  AZW: ['application/vnd.amazon.ebook'],
  AZW3: ['application/vnd.amazon.ebook'],
  FB2: ['application/x-fictionbook+xml'],
  FBZ: ['application/x-zip-compressed-fb2'],
  CBZ: ['application/vnd.comicbook+zip', 'application/x-cbz'],
  TXT: ['text/plain'],
};

// ==================== DocumentLoader 类 ====================

export class DocumentLoader {
  private file: File;

  constructor(file: File) {
    this.file = file;
  }

  // -------------------- 格式检测 --------------------

  private async isZip(): Promise<boolean> {
    const arr = new Uint8Array(await this.file.slice(0, 4).arrayBuffer());
    return arr[0] === 0x50 && arr[1] === 0x4b && arr[2] === 0x03 && arr[3] === 0x04;
  }

  private async isPDF(): Promise<boolean> {
    const arr = new Uint8Array(await this.file.slice(0, 5).arrayBuffer());
    return (
      arr[0] === 0x25 && arr[1] === 0x50 && arr[2] === 0x44 && arr[3] === 0x46 && arr[4] === 0x2d
    );
  }

  private isCBZ(): boolean {
    return (
      this.file.type === 'application/vnd.comicbook+zip' || 
      this.file.name.endsWith('.cbz')
    );
  }

  private isFB2(): boolean {
    return (
      this.file.type === 'application/x-fictionbook+xml' || 
      this.file.name.endsWith('.fb2')
    );
  }

  private isFBZ(): boolean {
    return (
      this.file.type === 'application/x-zip-compressed-fb2' ||
      this.file.name.endsWith('.fb2.zip') ||
      this.file.name.endsWith('.fbz')
    );
  }

  private isTXT(): boolean {
    return this.file.type === 'text/plain' || this.file.name.endsWith('.txt');
  }

  // -------------------- ZIP 加载器 --------------------

  private async makeZipLoader() {
    await configureZip();
    const { ZipReader, BlobReader, TextWriter, BlobWriter } = await import('@zip.js/zip.js');
    type Entry = import('@zip.js/zip.js').Entry;
    
    const reader = new ZipReader(new BlobReader(this.file));
    const entries = await reader.getEntries();
    const map = new Map(entries.map((entry) => [entry.filename, entry]));
    
    const load =
      (f: (entry: Entry, type?: string) => Promise<string | Blob> | null) =>
      (name: string, ...args: [string?]) =>
        map.has(name) ? f(map.get(name)!, ...args) : null;

    const loadText = load((entry: Entry) =>
      !entry.directory ? entry.getData(new TextWriter()) : null,
    );
    const loadBlob = load((entry: Entry, type?: string) =>
      !entry.directory ? entry.getData(new BlobWriter(type!)) : null,
    );
    const getSize = (name: string) => map.get(name)?.uncompressedSize ?? 0;

    return { entries, loadText, loadBlob, getSize };
  }

  // -------------------- 主加载方法 --------------------

  public async open(): Promise<{ book: BookDoc; format: BookFormat }> {
    let book: BookDoc | null = null;
    let format: BookFormat = 'EPUB';

    if (!this.file.size) {
      throw new Error('File is empty');
    }

    try {
      // ZIP 格式 (EPUB, CBZ, FBZ)
      if (await this.isZip()) {
        const loader = await this.makeZipLoader();
        const { entries } = loader;

        if (this.isCBZ()) {
          // CBZ 漫画
          const { makeComicBook } = await import('foliate-js/comic-book.js');
          book = await makeComicBook(loader, this.file);
          format = 'CBZ';
        } else if (this.isFBZ()) {
          // FBZ (压缩的 FB2)
          const entry = entries.find((e) => e.filename.endsWith('.fb2'));
          const blob = await loader.loadBlob((entry ?? entries[0]!).filename);
          const { makeFB2 } = await import('foliate-js/fb2.js');
          book = await makeFB2(blob);
          format = 'FBZ';
        } else {
          // EPUB
          const { EPUB } = await import('foliate-js/epub.js');
          book = await new EPUB(loader).init();
          format = 'EPUB';
        }
      }
      // PDF
      else if (await this.isPDF()) {
        const { makePDF } = await import('foliate-js/pdf.js');
        book = await makePDF(this.file);
        format = 'PDF';
      }
      // MOBI/AZW/AZW3
      else if (await (await import('foliate-js/mobi.js')).isMOBI(this.file)) {
        const fflate = await import('foliate-js/vendor/fflate.js');
        const { MOBI } = await import('foliate-js/mobi.js');
        book = await new MOBI({ unzlib: fflate.unzlibSync }).open(this.file);
        
        // 检测具体格式
        const ext = this.file.name.split('.').pop()?.toLowerCase();
        switch (ext) {
          case 'azw':
            format = 'AZW';
            break;
          case 'azw3':
            format = 'AZW3';
            break;
          default:
            format = 'MOBI';
        }
      }
      // FB2
      else if (this.isFB2()) {
        const { makeFB2 } = await import('foliate-js/fb2.js');
        book = await makeFB2(this.file);
        format = 'FB2';
      }
      // TXT
      else if (this.isTXT()) {
        // TXT 需要特殊处理，foliate-js 没有原生支持
        // 可以包装成单章节 EPUB
        book = await this.makeTXTBook();
        format = 'TXT';
      }
    } catch (e: unknown) {
      console.error('Failed to open document:', e);
      if (e instanceof Error && e.message?.includes('not a valid zip')) {
        throw new Error('Unsupported or corrupted book file');
      }
      throw e;
    }

    if (!book) {
      throw new Error('Unsupported file format');
    }

    return { book, format };
  }

  // -------------------- TXT 特殊处理 --------------------

  private async makeTXTBook(): Promise<BookDoc> {
    const text = await this.file.text();
    
    // 简单分段：每 5000 字一章
    const CHAPTER_SIZE = 5000;
    const sections: Section[] = [];
    
    for (let i = 0; i < text.length; i += CHAPTER_SIZE) {
      const chapterText = text.slice(i, i + CHAPTER_SIZE);
      const chapterNum = Math.floor(i / CHAPTER_SIZE) + 1;
      
      // 创建 HTML 包装
      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { 
      font-family: system-ui, -apple-system, sans-serif;
      line-height: 1.6;
      padding: 2em;
      max-width: 40em;
      margin: 0 auto;
    }
  </style>
</head>
<body>
  <pre>${this.escapeHtml(chapterText)}</pre>
</body>
</html>`;
      
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      
      sections.push({
        id: `chapter-${chapterNum}`,
        cfi: `/${chapterNum}`,
        size: chapterText.length,
        linear: 'yes',
        load: async () => url,
        unload: () => URL.revokeObjectURL(url),
      });
    }

    return {
      metadata: {
        title: this.file.name.replace(/\.txt$/i, ''),
        author: 'Unknown',
        language: 'zh-CN',
      },
      rendition: {
        layout: 'reflowable',
      },
      dir: 'ltr',
      sections,
      toc: sections.map((s, i) => ({
        id: i,
        label: `Chapter ${i + 1}`,
        href: s.id,
        index: i,
      })),
      getCover: async () => null,
      splitTOCHref: (href: string) => [href, ''],
    };
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// ==================== 辅助函数 ====================

export const getDirection = (doc: Document) => {
  const { defaultView } = doc;
  const { writingMode, direction } = defaultView!.getComputedStyle(doc.body);
  const vertical = writingMode === 'vertical-rl' || writingMode === 'vertical-lr';
  const rtl = doc.body.dir === 'rtl' || direction === 'rtl' || doc.documentElement.dir === 'rtl';
  return { vertical, rtl };
};

export const getFileExtFromMimeType = (mimeType?: string): string => {
  if (!mimeType) return '';
  
  for (const format in MIMETYPES) {
    const list = MIMETYPES[format as BookFormat];
    if (list.includes(mimeType)) {
      return EXTS[format as BookFormat];
    }
  }
  return '';
};

export const getMimeTypeFromFileExt = (ext: string): string => {
  ext = ext.toLowerCase();
  for (const format in EXTS) {
    if (EXTS[format as BookFormat] === ext) {
      const mimeTypes = MIMETYPES[format as BookFormat];
      return mimeTypes[0] ?? '';
    }
  }
  return '';
};
```

## 2. 使用示例

```typescript
// 在 ReaderView 中使用

const loadBook = async (filePath: string) => {
  // 1. 读取文件
  const blob = await fetchFile(filePath);
  const file = new File([blob], getFileName(filePath), { type: blob.type });
  
  // 2. 使用 DocumentLoader 解析
  const loader = new DocumentLoader(file);
  const { book, format } = await loader.open();
  
  console.log(`Loaded ${format} book:`, book.metadata.title);
  console.log(`Sections:`, book.sections.length);
  
  // 3. 传递给 FoliateViewer
  setBookDoc(book);
};

// 错误处理
try {
  await loadBook('/path/to/book.pdf');
} catch (error) {
  if (error.message.includes('Unsupported')) {
    showToast('不支持的文件格式');
  } else if (error.message.includes('corrupted')) {
    showToast('文件已损坏');
  } else {
    showToast('加载失败: ' + error.message);
  }
}
```

## 3. 缓存集成

```typescript
// 带缓存的 DocumentLoader

import { openDB } from 'idb';

const BOOK_CACHE_DB = 'book-cache';
const BOOK_CACHE_STORE = 'books';
const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7天

const dbPromise = openDB(BOOK_CACHE_DB, 1, {
  upgrade(db) {
    db.createObjectStore(BOOK_CACHE_STORE, { keyPath: 'path' });
  },
});

export class CachedDocumentLoader extends DocumentLoader {
  private filePath: string;

  constructor(file: File, filePath: string) {
    super(file);
    this.filePath = filePath;
  }

  async open(): Promise<{ book: BookDoc; format: BookFormat }> {
    // 检查缓存
    const db = await dbPromise;
    const cached = await db.get(BOOK_CACHE_STORE, this.filePath);
    
    if (cached && Date.now() - cached.timestamp < CACHE_MAX_AGE) {
      console.log('Using cached book:', this.filePath);
      return { book: cached.bookDoc, format: cached.format };
    }
    
    // 解析书籍
    const result = await super.open();
    
    // 存入缓存（序列化后的 bookDoc）
    await db.put(BOOK_CACHE_STORE, {
      path: this.filePath,
      bookDoc: result.book,
      format: result.format,
      timestamp: Date.now(),
    });
    
    return result;
  }
}
```

## 4. 注意事项

1. **内存管理**: BookDoc 中的 sections 可能持有 blob URL，需要在组件卸载时调用 `unload()`
2. **错误处理**: 不同格式的错误信息不同，需要统一包装
3. **性能**: 大文件解析可能耗时，考虑使用 Web Worker
4. **类型安全**: 确保所有格式都返回符合 BookDoc 接口的对象
