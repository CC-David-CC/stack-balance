export type RngState = number;
export function hashSeed(seed: string | number): number {
  let h = 0x9e3779b9;
  const text = String(seed);
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  return h >>> 0;
}
export class Rng {
  private state: number;
  constructor(seed: string | number = "stack-balance") {
    const initial = hashSeed(seed);
    this.state = initial === 0 ? 0x6d2b79f5 : initial;
  }
  next(): number {
    let x = this.state;
    x ^= (x << 13) >>> 0;
    x ^= x >>> 17;
    x ^= (x << 5) >>> 0;
    this.state = x >>> 0;
    return this.state / 0x100000000;
  }
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }
  getState(): RngState {
    return this.state;
  }
  setState(state: RngState): void {
    this.state = state >>> 0;
  }
}
