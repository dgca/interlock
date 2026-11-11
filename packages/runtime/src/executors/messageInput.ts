/** A bounded live input stream; acknowledgement means the native SDK consumed input. */
export class MessageInput<T> implements AsyncIterable<T> {
  private queue: {
    value: T;
    resolve: () => void;
    reject: (e: Error) => void;
  }[] = [];
  private wake?: () => void;
  private closed = false;
  send(value: T): Promise<void> {
    if (this.closed || this.queue.length >= 100)
      return Promise.reject(new Error('Native input unavailable'));
    return new Promise((resolve, reject) => {
      this.queue.push({ value, resolve, reject });
      this.wake?.();
      this.wake = undefined;
    });
  }
  close() {
    this.closed = true;
    for (const item of this.queue.splice(0))
      item.reject(new Error('Native input ended'));
    this.wake?.();
    this.wake = undefined;
  }
  async *[Symbol.asyncIterator]() {
    while (!this.closed) {
      if (!this.queue.length)
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
      if (this.closed) break;
      const item = this.queue.shift();
      if (item) {
        yield item.value;
        item.resolve();
      }
    }
  }
}
