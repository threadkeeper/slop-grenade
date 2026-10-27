/** Local epochs reject work issued before a wipe, even against legacy responders. */
export class ResetBoundary {
  epoch = 0;
  generation = 0;

  constructor(private clear: () => void) {}

  wipe(generation?: number): boolean {
    if (generation !== undefined && (!Number.isSafeInteger(generation) || generation < 0)) return false;
    if (generation && generation <= this.generation) return false;
    this.generation = Math.max(this.generation, generation ?? 0);
    ++this.epoch;
    this.clear();
    return true;
  }

  snapshot(generation = 0, epoch = this.epoch): boolean {
    if (!Number.isSafeInteger(generation) || generation < 0) return false;
    if (epoch !== this.epoch || generation < this.generation) return false;
    if (generation > this.generation) this.wipe(generation);
    return true;
  }

  event(generation?: number): boolean {
    // Older native bridges do not stamp ordinary animation events.
    return generation === undefined || this.snapshot(generation);
  }
}
