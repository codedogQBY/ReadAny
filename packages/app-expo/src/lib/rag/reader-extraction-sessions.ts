function createAbortError(): Error {
  const error = new Error("Vectorization cancelled");
  error.name = "AbortError";
  return error;
}

/** Owns parser results by request so concurrent reader work cannot cross books. */
export class ReaderExtractionSessions<Book> {
  private readonly books = new Map<string, Book>();
  private readonly cancelled = new Set<string>();

  async open(requestId: string, load: () => Promise<Book>): Promise<Book> {
    this.throwIfCancelled(requestId);
    try {
      const book = await load();
      this.throwIfCancelled(requestId);
      this.books.set(requestId, book);
      return book;
    } catch (error) {
      this.books.delete(requestId);
      if (this.cancelled.has(requestId)) {
        this.cancelled.delete(requestId);
        throw createAbortError();
      }
      throw error;
    }
  }

  cancel(requestId: string): void {
    this.cancelled.add(requestId);
    this.books.delete(requestId);
  }

  getBook(requestId: string): Book {
    this.throwIfCancelled(requestId);
    const book = this.books.get(requestId);
    if (!book) throw new Error(`Book for extraction request ${requestId} is not available`);
    return book;
  }

  throwIfCancelled(requestId?: string): void {
    if (requestId && this.cancelled.has(requestId)) throw createAbortError();
  }

  release(requestId?: string): void {
    if (!requestId) return;
    this.books.delete(requestId);
    this.cancelled.delete(requestId);
  }
}
