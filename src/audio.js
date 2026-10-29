/**
 * @fileoverview Pure WebAudio synthesized BGM and juicy fruit merge/kalimba SFX
 * for Synthetic Big Watermelon 3D (合成大西瓜 3D).
 *
 * Key guarantees:
 * - Zero external audio asset requests (0 HTTP 404s)
 * - Pure WebAudio oscillator synthesis (no browser TTS APIs)
 * - Idempotent user-gesture unlock & strict protection against keydown ev.repeat floods
 */

const PENTATONIC_HZ = [
  261.63, // C4
  293.66, // D4
  329.63, // E4
  392.00, // G4
  440.00, // A4
  523.25, // C5
  587.33, // D5
  659.25, // E5
  783.99, // G5
  880.00, // A5
  1046.50, // C6
];

export class WatermelonAudio {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.bgmGain = null;
    this.sfxGain = null;
    this.unlocked = false;
    this.muted = false;
    this.bgmPlaying = false;
    this.bgmStep = 0;
    this.bgmTimerId = null;
    this.sfxCount = 0;
    this.activeNodes = 0;
    this.maxConcurrentNodes = 16;
    this.lastSfxTimeByType = new Map();
  }

  _ensureContext() {
    if (this.ctx) return this.ctx;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    try {
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.bgmGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();

      this.masterGain.gain.value = this.muted ? 0 : 0.85;
      this.bgmGain.gain.value = 0.16;
      this.sfxGain.gain.value = 0.55;

      this.bgmGain.connect(this.masterGain);
      this.sfxGain.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);
    } catch (_) {
      this.ctx = null;
    }
    return this.ctx;
  }

  /**
   * Idempotently unlocks WebAudio on first valid user gesture.
   * Ignores synthetic repeated keydown events (`ev.repeat === true`).
   * @param {Event=} ev
   * @return {boolean}
   */
  unlock(ev) {
    if (ev && ev.repeat) {
      return this.unlocked;
    }
    const ctx = this._ensureContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    if (!this.unlocked) {
      this.unlocked = true;
      this.startBgm();
    }
    return this.unlocked;
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(
          this.muted ? 0 : 0.85,
          this.ctx.currentTime
      );
    }
    return this.muted;
  }

  toggleMute() {
    return this.setMuted(!this.muted);
  }

  startBgm() {
    if (this.bgmPlaying) return;
    this.bgmPlaying = true;
    const melody = [0, 2, 3, 5, 3, 2, 4, 3, 1, 2, 4, 6, 5, 3, 2, 0];
    this.bgmTimerId = window.setInterval(() => {
      if (!this.bgmPlaying || !this.unlocked || this.muted || document.hidden) return;
      const ctx = this.ctx;
      if (!ctx || ctx.state !== 'running') return;
      const noteIdx = melody[this.bgmStep % melody.length];
      this.bgmStep += 1;
      const freq = PENTATONIC_HZ[noteIdx] || 392.0;
      this._spawnTone({
        freq,
        type: 'sine',
        duration: 0.16,
        gain: 0.08,
        bus: 'bgm',
      });
    }, 320);
  }

  stopBgm() {
    this.bgmPlaying = false;
    if (this.bgmTimerId !== null) {
      window.clearInterval(this.bgmTimerId);
      this.bgmTimerId = null;
    }
  }

  _canTriggerSfx(type, minIntervalMs = 35) {
    const now = performance.now();
    const last = this.lastSfxTimeByType.get(type) || 0;
    if (now - last < minIntervalMs) {
      return false;
    }
    this.lastSfxTimeByType.set(type, now);
    return true;
  }

  _spawnTone({
    freq = 440,
    endFreq = null,
    type = 'sine',
    duration = 0.12,
    delay = 0,
    gain = 0.22,
    bus = 'sfx',
  }) {
    // Only synthesize WebAudio nodes after user gesture unlock!
    if (!this.unlocked || this.muted || !this.ctx) return;
    if (this.activeNodes >= this.maxConcurrentNodes) return;

    const ctx = this.ctx;
    try {
      const now = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(40, freq), now);
      if (endFreq && Number.isFinite(endFreq)) {
        osc.frequency.exponentialRampToValueAtTime(
            Math.max(40, endFreq),
            now + duration
        );
      }

      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(
          gain,
          now + Math.min(0.015, duration * 0.25)
      );
      env.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      osc.connect(env);
      env.connect(bus === 'bgm' ? this.bgmGain : this.sfxGain);

      this.activeNodes += 1;
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        this.activeNodes = Math.max(0, this.activeNodes - 1);
        try {
          osc.disconnect();
          env.disconnect();
        } catch (_) {}
      };
      osc.onended = cleanup;
      window.setTimeout(cleanup, Math.ceil((delay + duration) * 1000) + 40);

      osc.start(now);
      osc.stop(now + duration + 0.01);
    } catch (_) {}
  }

  playDrop() {
    if (!this._canTriggerSfx('drop', 45)) return;
    this.sfxCount += 1;
    this._spawnTone({
      freq: 380,
      endFreq: 210,
      type: 'sine',
      duration: 0.09,
      gain: 0.2,
    });
  }

  playBounce(tier = 0) {
    if (!this._canTriggerSfx('bounce', 60)) return;
    this.sfxCount += 1;
    const base = Math.max(110, 260 - tier * 14);
    this._spawnTone({
      freq: base,
      endFreq: base * 0.68,
      type: 'triangle',
      duration: 0.07,
      gain: 0.14,
    });
  }

  playMerge(toTier = 1, combo = 1) {
    if (!this._canTriggerSfx(`merge_${toTier}`, 25)) return;
    this.sfxCount += 1;
    const noteIndex = Math.min(
        PENTATONIC_HZ.length - 1,
        Math.max(0, toTier + Math.min(3, combo - 1))
    );
    const rootFreq = PENTATONIC_HZ[noteIndex];

    this._spawnTone({
      freq: rootFreq * 0.75,
      endFreq: rootFreq * 1.25,
      type: 'sine',
      duration: 0.12,
      gain: 0.28,
    });
    this._spawnTone({
      freq: rootFreq * 1.5,
      endFreq: rootFreq * 2.0,
      type: 'triangle',
      duration: 0.16,
      delay: 0.05,
      gain: 0.22,
    });

    if (toTier >= 10) {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, idx) => {
        this._spawnTone({
          freq: f,
          type: 'triangle',
          duration: 0.22,
          delay: 0.08 * (idx + 1),
          gain: 0.26,
        });
      });
    }
  }

  playGoldenFountain() {
    if (!this._canTriggerSfx('fountain', 80)) return;
    this.sfxCount += 1;
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, idx) => {
      this._spawnTone({
        freq: f,
        endFreq: f * 1.12,
        type: 'triangle',
        duration: 0.24,
        delay: idx * 0.06,
        gain: 0.28,
      });
    });
  }

  playTool(toolType) {
    if (!this._canTriggerSfx(`tool_${toolType}`, 45)) return;
    this.sfxCount += 1;
    if (toolType === 'shake') {
      this._spawnTone({
        freq: 140,
        endFreq: 290,
        type: 'sawtooth',
        duration: 0.18,
        gain: 0.2,
      });
    } else if (toolType === 'hammer') {
      this._spawnTone({
        freq: 480,
        endFreq: 130,
        type: 'square',
        duration: 0.14,
        gain: 0.24,
      });
    } else if (toolType === 'rainbow') {
      [440, 554.37, 659.25, 880].forEach((f, i) => {
        this._spawnTone({
          freq: f,
          type: 'sine',
          duration: 0.14,
          delay: i * 0.04,
          gain: 0.22,
        });
      });
    }
  }

  playWarning() {
    if (!this._canTriggerSfx('warning', 450)) return;
    this.sfxCount += 1;
    this._spawnTone({
      freq: 660,
      endFreq: 520,
      type: 'sine',
      duration: 0.12,
      gain: 0.16,
    });
  }

  playPodium(stars = 0) {
    if (!this._canTriggerSfx('podium', 120)) return;
    this.sfxCount += 1;
    const notes =
      stars >= 3
        ? [523.25, 659.25, 783.99, 1046.5]
        : stars >= 1
          ? [392.0, 493.88, 587.33]
          : [329.63, 261.3];
    notes.forEach((f, i) => {
      this._spawnTone({
        freq: f,
        type: 'triangle',
        duration: 0.22,
        delay: i * 0.09,
        gain: 0.24,
      });
    });
  }

  getDiagnostics() {
    return {
      unlocked: this.unlocked,
      muted: this.muted,
      bgmPlaying: this.bgmPlaying,
      sfxCount: this.sfxCount,
      activeNodes: this.activeNodes,
      contextState: this.ctx ? this.ctx.state : 'uninitialized',
    };
  }
}
