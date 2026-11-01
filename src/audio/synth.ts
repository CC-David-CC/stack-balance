export class SynthAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = true;

  unlock(): void {
    if (typeof AudioContext === "undefined") return;
    if (this.context === null) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") void this.context.resume();
    this.muted = false;
    this.applyMute();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMute();
  }

  setVolume(value: number): void {
    if (this.master !== null) this.master.gain.value = this.muted ? 0 : Math.max(0, Math.min(1, value)) * 0.2;
  }

  suspend(): void {
    if (this.context?.state === "running") void this.context.suspend();
  }

  resume(): void {
    if (this.context?.state === "suspended") void this.context.resume();
  }

  private applyMute(): void {
    if (this.master !== null) this.master.gain.value = this.muted ? 0 : 0.07;
  }

  tone(frequency: number, durationMs: number, type: OscillatorType = "square"): void {
    if (this.context === null || this.master === null || this.muted) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(1, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + durationMs / 1000);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start();
    oscillator.stop(this.context.currentTime + durationMs / 1000);
  }

  dispose(): void {
    if (this.context !== null) void this.context.close();
    this.context = null;
    this.master = null;
  }
}
