import { open } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import { MAX_RAW_OUTPUT_BYTES, OutputLimitError } from "./failure.js";

const READ_BYTES = 1024 * 1024;

/**
 * Reads only what has been appended to a file since the last read.
 *
 * The quota poller runs once a second for up to an hour against a log that
 * grows continuously; re-reading the whole file each time makes the scan cost
 * grow with run length for no benefit.
 *
 * A read can land mid-line, which would hide the very 429 line the poller is
 * looking for, so an incomplete trailing line is carried into the next read
 * rather than returned. `flush` returns it when there will be no next read.
 */
export class LogTail {
  private offset = 0;
  private carry = "";
  private decoder = new StringDecoder("utf8");
  private bytesRead = 0;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly maxBytes = MAX_RAW_OUTPUT_BYTES,
  ) {}

  /** Reads a fixed-size block; the file's size never becomes an allocation size. */
  private async append(): Promise<boolean> {
    let handle;
    try {
      handle = await open(this.path, "r");
    } catch {
      return false;
    }
    try {
      const { size } = await handle.stat();
      // Truncated or rotated underneath us — start over rather than read garbage.
      if (size < this.offset) {
        this.offset = 0;
        this.carry = "";
        this.decoder = new StringDecoder("utf8");
      }
      if (size <= this.offset) return false;
      if (this.bytesRead + size - this.offset > this.maxBytes)
        throw new OutputLimitError("run log", this.maxBytes);
      const length = Math.min(size - this.offset, READ_BYTES);
      const buf = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(buf, 0, length, this.offset);
      this.offset += bytesRead;
      this.bytesRead += bytesRead;
      // StringDecoder, not toString: a codepoint straddling this read's end
      // would otherwise be corrupted into U+FFFD instead of joining the next.
      this.carry += this.decoder.write(buf.subarray(0, bytesRead));
      return bytesRead > 0 && this.offset < size;
    } catch (error) {
      if (error instanceof OutputLimitError) throw error;
      // unreadable this tick; the next one retries from the same offset
      return false;
    } finally {
      await handle.close().catch(() => {});
    }
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.pending.then(fn);
    // A final flush can overlap the polling read; each byte belongs to one read.
    this.pending = result.catch(() => {});
    return result;
  }

  /** Complete lines appended since the previous call. */
  async read(): Promise<string> {
    return this.serial(async () => {
      await this.append();
      const cut = this.carry.lastIndexOf("\n");
      if (cut === -1) return "";
      const out = this.carry.slice(0, cut + 1);
      this.carry = this.carry.slice(cut + 1);
      return out;
    });
  }

  /** Everything still unread, including a final line with no newline. */
  async flush(): Promise<string> {
    return this.serial(async () => {
      while (await this.append()) {
        // The total raw cap also bounds a log containing one unterminated line.
      }
      const out = this.carry;
      this.carry = "";
      return out;
    });
  }
}
