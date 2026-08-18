export class VectorizationQueue<Book extends { id: string }> {
  private queuedBooks: Book[] = [];
  private active: { book: Book; controller: AbortController; cancellable: boolean } | null = null;

  get activeBookId(): string | null {
    return this.active?.book.id ?? null;
  }

  snapshot(): Book[] {
    return [...this.queuedBooks];
  }

  enqueue(book: Book): boolean {
    if (this.active?.book.id === book.id || this.queuedBooks.some((item) => item.id === book.id)) {
      return false;
    }
    this.queuedBooks.push(book);
    return true;
  }

  startNext(): { book: Book; signal: AbortSignal } | null {
    if (this.active) return null;
    const book = this.queuedBooks.shift();
    if (!book) return null;
    const controller = new AbortController();
    this.active = { book, controller, cancellable: true };
    return { book, signal: controller.signal };
  }

  cancel(bookId: string): "active" | "queued" | "not-cancellable" | "not-found" {
    if (this.active?.book.id === bookId) {
      if (!this.active.cancellable) return "not-cancellable";
      this.active.cancellable = false;
      this.active.controller.abort();
      return "active";
    }
    const nextQueue = this.queuedBooks.filter((book) => book.id !== bookId);
    if (nextQueue.length === this.queuedBooks.length) return "not-found";
    this.queuedBooks = nextQueue;
    return "queued";
  }

  markTerminal(bookId: string): void {
    if (this.active?.book.id === bookId) this.active.cancellable = false;
  }

  finish(bookId: string): void {
    if (this.active?.book.id === bookId) this.active = null;
  }
}
