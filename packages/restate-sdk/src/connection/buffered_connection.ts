import { encodeMessages } from "../io/encoder";
import { Message } from "../types/types";
import { Connection } from "./connection";

export class BufferedConnection implements Connection {
  private queue: Message[] = [];
  private flushing: Promise<void> = Promise.resolve();

  constructor(private readonly flushFn: (buffer: Buffer) => Promise<void>) {}

  send(msg: Message): Promise<void> {
    const len = this.queue.push(msg);
    if (len === 1) {
      // we are the first in line, therefore we schedule a flush,
      // BUT we must wait for the previous flush to end.
      this.flushing = this.flushing.then(() => this.scheduleFlush());
    }
    // we don't need to reschedule the `flush` here,
    // because the flush happens anyway at the end of the current event loop iteration.
    // tag along to the previously scheduled flush.
    return this.flushing;
  }

  end(): Promise<void> {
    this.flushing = this.flushing.then(() => this.flush());
    return this.flushing;
  }

  private scheduleFlush(): Promise<void> {
    // schedule a flush at the end of the current event loop iteration.
    return new Promise((resolve, reject) =>
      setImmediate(() => {
        this.flush().then(resolve).catch(reject);
      })
    );
  }

  private async flush(): Promise<void> {
    if (this.queue.length === 0) {
      return Promise.resolve();
    }
    const buffer = encodeMessages(this.queue) as Buffer;
    this.queue = [];

    return this.flushFn(buffer);
  }
}
