export class CommandQueue {
  private current: Promise<unknown> = Promise.resolve();

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.current.then(task, task);
    this.current = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}
