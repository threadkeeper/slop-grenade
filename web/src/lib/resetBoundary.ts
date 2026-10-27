/** Local epochs reject work issued before a wipe, even against legacy responders. */
export class ResetBoundary {
  epoch = 0;
  generation = 0;
  private restartAllowed = false;

  constructor(private clear: () => void) {}

  restart(): void {
    this.clearAt(0);
  }

  reconnect(): void {
    ++this.epoch;
    this.restartAllowed = true;
  }

  wipe(generation?: number): boolean {
    if (generation !== undefined && (!Number.isSafeInteger(generation) || generation < 0)) return false;
    if (generation !== undefined && generation < this.generation && this.restartAllowed) {
      this.clearAt(generation);
      return true;
    }
    if (generation && generation <= this.generation) {
      this.restartAllowed = false;
      return false;
    }
    this.clearAt(Math.max(this.generation, generation ?? 0));
    return true;
  }

  snapshot(generation = 0, epoch = this.epoch): boolean {
    if (!Number.isSafeInteger(generation) || generation < 0) return false;
    if (epoch !== this.epoch || (generation < this.generation && !this.restartAllowed)) return false;
    if (generation !== this.generation) this.clearAt(generation);
    this.restartAllowed = false;
    return true;
  }

  event(generation?: number): boolean {
    // Older native bridges do not stamp ordinary animation events.
    return generation === undefined || this.snapshot(generation);
  }

  private clearAt(generation: number): void {
    this.generation = generation;
    this.restartAllowed = false;
    ++this.epoch;
    this.clear();
  }
}
