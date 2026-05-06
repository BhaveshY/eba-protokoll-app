export class SingleFlight {
  private current: Promise<unknown> | null = null;

  get running(): boolean {
    return this.current !== null;
  }

  run<T>(task: () => Promise<T>): Promise<T> | null {
    if (this.current) return null;

    let promise: Promise<T>;
    try {
      promise = task();
    } catch (err) {
      this.current = null;
      throw err;
    }

    this.current = promise;
    const clear = () => {
      if (this.current === promise) this.current = null;
    };
    promise.then(clear, clear);
    return promise;
  }
}
