import { Rng } from "./rng.js";

export const TABLE_WIDTH = 12; // model units; presentation scale never changes these
export const SUPPORT_LINE = 4;
export const DWELL_MS = 2000;
export const MIN_SUPPORT_RATIO = 0.5;

export type Phase = "build" | "settle" | "nudge" | "won" | "collapsed";
export type BlockShape = "square" | "wide" | "tall" | "beam";

export interface BlockSpec {
  shape: BlockShape;
  width: number;
  height: number;
  mass: number;
}

export interface PlacedBlock extends BlockSpec {
  id: number;
  x: number;
  y: number;
  rested: boolean;
}

export interface Challenge {
  id: number;
  sequence: BlockSpec[];
  heightTarget: number;
}

const SHAPES: Record<BlockShape, BlockSpec> = {
  square: { shape: "square", width: 2, height: 2, mass: 2 },
  wide: { shape: "wide", width: 3, height: 1.5, mass: 2.5 },
  tall: { shape: "tall", width: 1.5, height: 3, mass: 2.5 },
  beam: { shape: "beam", width: 4, height: 1, mass: 3 },
};

function generateChallenges(): Challenge[] {
  const rng = new Rng("challenges");
  const shapes = Object.values(SHAPES);
  return Array.from({ length: 10 }, (_, id) => ({
    id,
    sequence: Array.from({ length: 4 + (id % 4) }, (_, index) => ({
      ...shapes[rng.int(index < 3 ? 4 : 3)],
    })),
    heightTarget: 6 + id,
  }));
}

export const CHALLENGES: readonly Challenge[] = generateChallenges();

export interface StackSnapshot {
  challengeId: number;
  phase: Phase;
  sequenceIndex: number;
  blocks: PlacedBlock[];
  active: { x: number; spec: BlockSpec; rotation?: 0 | 1 } | null;
  dwellMs: number;
  nudgeMs: number;
  nudgeApplied: boolean;
  score: number;
  practice: boolean;
  rngState: number;
}

export class StackSession {
  readonly rng: Rng;
  challengeId = 0;
  phase: Phase = "build";
  sequenceIndex = 0;
  blocks: PlacedBlock[] = [];
  active: { x: number; spec: BlockSpec; rotation?: 0 | 1 } | null = null;
  dwellMs = 0;
  nudgeMs = 0;
  nudgeApplied = false;
  score = 0;
  practice = false;
  private nextId = 1;

  constructor(seed: string | number = "stack-balance", challengeId = 0, snapshot?: StackSnapshot) {
    this.rng = new Rng(seed);
    this.challengeId = challengeId;
    if (snapshot !== undefined) {
      this.applySnapshot(snapshot);
      return;
    }
    this.active = { x: TABLE_WIDTH / 2, spec: this.challenge.sequence[0], rotation: 0 };
  }

  get challenge(): Challenge {
    return CHALLENGES[this.challengeId];
  }

  activeSpec(): BlockSpec | null {
    if (this.active === null) return null;
    const { spec } = this.active;
    return this.active.rotation === 1
      ? {...spec, width: spec.height, height: spec.width}
      : {...spec};
  }

  /** Active-block manipulation stays bounded to the build region. */
  positionBlock(x: number): void {
    if (this.phase !== "build" || this.active === null) return;
    const width = this.activeSpec()!.width;
    this.active.x = Math.min(TABLE_WIDTH - width / 2, Math.max(width / 2, x));
  }

  rotateBlock(): void {
    if (this.phase !== "build" || this.active === null) return;
    this.active.rotation = this.active.rotation === 1 ? 0 : 1;
    this.positionBlock(this.active.x);
  }

  /** Release always commits; a dropped input can never leave a block attached. */
  releaseBlock(): void {
    if (this.phase !== "build" || this.active === null) return;
    const spec = this.activeSpec()!;
    const support = this.supportIntervalAt(this.active.x, spec.width);
    const ratio = support.overlap / spec.width;
    const y = support.top;
    if (ratio < MIN_SUPPORT_RATIO && this.blocks.length > 0) {
      this.blocks.push({ id: this.nextId++, ...spec, x: this.active.x, y, rested: false });
      this.phase = "collapsed";
      this.active = null;
      return;
    }
    this.blocks.push({ id: this.nextId++, ...spec, x: this.active.x, y, rested: true });
    this.sequenceIndex += 1;
    if (this.sequenceIndex >= this.challenge.sequence.length) {
      this.active = null;
      this.phase = "settle";
    } else {
      this.active = { x: this.active.x, spec: this.challenge.sequence[this.sequenceIndex], rotation: 0 };
    }
  }

  private supportIntervalAt(x: number, width: number): { overlap: number; top: number } {
    let top = 0;
    let overlap = Math.min(width, TABLE_WIDTH); // table supports the full block
    for (const block of this.blocks) {
      if (!block.rested) continue;
      const left = Math.max(x - width / 2, block.x - block.width / 2);
      const right = Math.min(x + width / 2, block.x + block.width / 2);
      if (right > left && block.y + block.height >= top - 0.001) {
        top = block.y + block.height;
        overlap = Math.max(0, right - left);
      }
    }
    return { overlap, top };
  }

  /** Objective predicate: every rested block sits at or above the line. */
  stabilityHolds(): boolean {
    return this.blocks.length > 0 && this.blocks.every((block) => block.rested) && this.topHeight() >= SUPPORT_LINE;
  }

  topHeight(): number {
    return this.blocks.reduce((max, block) => Math.max(max, block.y + block.height), 0);
  }

  advance(deltaMs: number): void {
    const timeScale = this.practice ? 0.5 : 1;
    const step = Math.min(Math.max(0, deltaMs), 250) * timeScale;
    if (this.phase === "settle") {
      if (this.stabilityHolds()) {
        this.dwellMs += step;
        if (this.dwellMs >= DWELL_MS) {
          this.phase = "nudge";
          this.nudgeMs = 0;
        }
      } else {
        this.dwellMs = 0;
      }
      return;
    }
    if (this.phase === "nudge") {
      this.nudgeMs += step;
      if (this.nudgeMs >= 300 && !this.nudgeApplied) {
        this.nudgeApplied = true; // exactly one bounded nudge, in model units
        if (this.stabilityHolds()) {
          this.score = 100 + Math.round(this.topHeight() * 10);
          this.phase = "won";
        } else {
          this.phase = "collapsed";
        }
      }
    }
  }

  retry(): void {
    this.blocks = [];
    this.sequenceIndex = 0;
    this.dwellMs = 0;
    this.nudgeMs = 0;
    this.nudgeApplied = false;
    this.score = 0;
    this.phase = "build";
    this.active = { x: TABLE_WIDTH / 2, spec: this.challenge.sequence[0], rotation: 0 };
  }

  snapshot(): StackSnapshot {
    return {
      challengeId: this.challengeId,
      phase: this.phase,
      sequenceIndex: this.sequenceIndex,
      blocks: this.blocks.map((block) => ({ ...block })),
      active: this.active === null ? null : { x: this.active.x, spec: { ...this.active.spec }, rotation: this.active.rotation ?? 0 },
      dwellMs: this.dwellMs,
      nudgeMs: this.nudgeMs,
      nudgeApplied: this.nudgeApplied,
      score: this.score,
      practice: this.practice,
      rngState: this.rng.getState(),
    };
  }

  applySnapshot(snapshot: StackSnapshot): void {
    this.challengeId = snapshot.challengeId;
    this.phase = snapshot.phase;
    this.sequenceIndex = snapshot.sequenceIndex;
    this.blocks = snapshot.blocks.map((block) => ({ ...block }));
    this.nextId = Math.max(0, ...this.blocks.map((block) => block.id)) + 1;
    this.active = snapshot.active === null ? null : { x: snapshot.active.x, spec: { ...snapshot.active.spec }, rotation: snapshot.active.rotation ?? 0 };
    this.dwellMs = snapshot.dwellMs;
    this.nudgeMs = snapshot.nudgeMs;
    this.nudgeApplied = snapshot.nudgeApplied;
    this.score = snapshot.score;
    this.practice = snapshot.practice;
    this.rng.setState(snapshot.rngState);
  }
}

export const SAVE_FORMAT = "ksu.game.save";
export const SAVE_APP_ID = "stack-balance";

export class SaveError extends Error {
  constructor(reason: string) {
    super(`stack-balance save rejected: ${reason}`);
    this.name = "SaveError";
  }
}

export function encodeSave(session: StackSession): string {
  return JSON.stringify({
    format: SAVE_FORMAT,
    schemaVersion: 1,
    appId: SAVE_APP_ID,
    kind: "logical-snapshot",
    gameBuild: "unbound",
    contentVersion: "1",
    payload: session.snapshot(),
  });
}

export function decodeSave(text: string, maxBytes = 8 * 1024 * 1024): { payload: StackSnapshot } {
  if (text.length > maxBytes) throw new SaveError("document exceeds the size limit");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SaveError("document is not valid JSON");
  }
  const envelope = parsed as Record<string, unknown>;
  if (envelope.format !== SAVE_FORMAT || envelope.schemaVersion !== 1 || envelope.appId !== SAVE_APP_ID ||
      envelope.kind !== "logical-snapshot" || envelope.contentVersion !== "1") {
    throw new SaveError("wrong envelope");
  }
  const payload = envelope.payload as StackSnapshot;
  if (!payload || typeof payload !== "object" ||
      !Number.isInteger(payload.challengeId) || payload.challengeId < 0 || payload.challengeId >= CHALLENGES.length) {
    throw new SaveError("invalid challenge id");
  }
  const phases: Phase[] = ["build", "settle", "nudge", "won", "collapsed"];
  const validSpec = (spec: BlockSpec): boolean => !!spec && Object.values(SHAPES).some(
    candidate => spec.shape === candidate.shape && spec.width === candidate.width &&
      spec.height === candidate.height && spec.mass === candidate.mass,
  );
  if (!phases.includes(payload.phase) || !Number.isSafeInteger(payload.sequenceIndex) ||
      payload.sequenceIndex < 0 || payload.sequenceIndex > CHALLENGES[payload.challengeId].sequence.length ||
      !Array.isArray(payload.blocks) || payload.blocks.length > CHALLENGES[payload.challengeId].sequence.length ||
      !payload.blocks.every(block => block && Number.isSafeInteger(block.id) && block.id > 0 &&
        Number.isFinite(block.x) && block.x >= 0 && block.x <= TABLE_WIDTH &&
        Number.isFinite(block.y) && block.y >= 0 && block.y <= 100 &&
        typeof block.rested === "boolean" && validSpec(block)) ||
      new Set(payload.blocks.map(block => block.id)).size !== payload.blocks.length) {
    throw new SaveError("invalid block state");
  }
  if (payload.active !== null && (!validSpec(payload.active.spec) || !Number.isFinite(payload.active.x) ||
      payload.active.x < 0 || payload.active.x > TABLE_WIDTH ||
      ![undefined, 0, 1].includes(payload.active.rotation))) {
    throw new SaveError("invalid active block");
  }
  if ((payload.phase === "build" && payload.active === null) ||
      (payload.phase !== "build" && payload.active !== null) ||
      (payload.active !== null && payload.sequenceIndex >= CHALLENGES[payload.challengeId].sequence.length)) {
    throw new SaveError("inconsistent active block");
  }
  if (![payload.dwellMs, payload.nudgeMs, payload.score].every(value => Number.isFinite(value) && value >= 0) ||
      payload.dwellMs > 5000 || payload.nudgeMs > 1000 || payload.score > 100000 ||
      typeof payload.nudgeApplied !== "boolean" || typeof payload.practice !== "boolean" ||
      !Number.isInteger(payload.rngState) || payload.rngState < 0 || payload.rngState > 0xffffffff) {
    throw new SaveError("invalid counters");
  }
  return { payload };
}

export function sessionFromSave(envelope: { payload: StackSnapshot }): StackSession {
  return new StackSession("restore", envelope.payload.challengeId, envelope.payload);
}
