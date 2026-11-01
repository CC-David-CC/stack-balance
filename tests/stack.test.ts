import { describe, expect, it } from "vitest";
import {
  CHALLENGES,
  DWELL_MS,
  StackSession,
  TABLE_WIDTH,
  decodeSave,
  encodeSave,
  sessionFromSave,
} from "../src/model/stack.js";

describe("StackSession rules", () => {
  it("dwell counts only while objective predicates hold continuously", () => {
    const session = new StackSession("dwell", 0);
    session.active = { x: 5, spec: session.challenge.sequence[0] };
    session.releaseBlock();
    for (const spec of session.challenge.sequence.slice(1)) {
      session.active = { x: 5, spec };
      session.releaseBlock();
    }
    expect(session.phase).toBe("settle");
    session.advance(500);
    expect(session.dwellMs).toBeGreaterThan(0);
    session.blocks[0].rested = false; // a false predicate resets the dwell
    session.advance(100);
    expect(session.dwellMs).toBe(0);
  });

  it("nudge occurs exactly once in model units", () => {
    const session = new StackSession("nudge", 0);
    for (const spec of session.challenge.sequence) {
      session.active = { x: 5, spec };
      session.releaseBlock();
    }
    for (let elapsed = 0; elapsed < DWELL_MS + 300; elapsed += 250) session.advance(250);
    expect(session.nudgeApplied).toBe(true);
    const applied = session.nudgeApplied;
    session.advance(500);
    expect(session.nudgeApplied).toBe(applied);
  });

  it("release always commits so dropped input cannot leave a block attached", () => {
    const session = new StackSession("drop", 1);
    const first = session.sequenceIndex;
    session.releaseBlock();
    expect(session.sequenceIndex).toBe(first + 1);
    expect(session.active).not.toBeNull();
  });

  it("save before nudge restores its timer", () => {
    const session = new StackSession("save", 0);
    for (const spec of session.challenge.sequence) {
      session.active = { x: 5, spec };
      session.releaseBlock();
    }
    session.advance(1000);
    const restored = sessionFromSave(decodeSave(encodeSave(session)));
    expect(restored.dwellMs).toBe(session.dwellMs);
    expect(restored.nudgeApplied).toBe(false);
  });

  it("geometry and support use fixed model units", () => {
    expect(TABLE_WIDTH).toBe(12);
    expect(CHALLENGES).toHaveLength(10);
    const session = new StackSession("units", 2);
    const halfWidth = session.activeSpec()!.width / 2;
    session.positionBlock(-100);
    expect(session.active!.x).toBe(halfWidth);
    session.positionBlock(100);
    expect(session.active!.x).toBe(TABLE_WIDTH - halfWidth);
  });

  it("rotation swaps the footprint and keeps the block on the table", () => {
    const session = new StackSession("rotation", 0);
    const before = session.activeSpec()!;
    session.positionBlock(TABLE_WIDTH - 0.1);
    const edge = session.active!.x;
    session.rotateBlock();
    const after = session.activeSpec()!;
    expect(after.width).toBe(before.height);
    expect(after.height).toBe(before.width);
    expect(session.active!.x).toBeLessThanOrEqual(TABLE_WIDTH - after.width / 2);
    expect(session.active!.x).not.toBe(edge);
  });

  it("continues block ids after a saved tower is restored", () => {
    const session = new StackSession("ids", 0);
    for (const spec of session.challenge.sequence) {
      session.active = { x: 5, spec };
      session.releaseBlock();
    }
    const restored = sessionFromSave(decodeSave(encodeSave(session)));
    restored.retry();
    while (restored.active !== null && restored.phase === "build") restored.releaseBlock();
    expect(restored.blocks[0].id).toBeGreaterThan(1);
  });

  it("rejects malformed counters and duplicate block ids", () => {
    const session = new StackSession("invalid", 0);
    session.releaseBlock();
    const envelope = JSON.parse(encodeSave(session));
    envelope.payload.dwellMs = -1;
    expect(() => decodeSave(JSON.stringify(envelope))).toThrow(/invalid counters/);

    const duplicate = JSON.parse(encodeSave(session));
    const first = duplicate.payload.blocks[0];
    duplicate.payload.blocks.push({...first});
    duplicate.payload.sequenceIndex = 2;
    expect(() => decodeSave(JSON.stringify(duplicate))).toThrow(/invalid block state/);
  });
});
