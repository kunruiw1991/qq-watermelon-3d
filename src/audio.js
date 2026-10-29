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
  261.63, // C4 (tier 0)
  293.66, // D4 (tier 1)
  329.63, // E4 (tier 2)
  392.00, // G4 (tier 3)
  440.00, // A4 (tier 4)
  523.25, // C5 (tier 5)
  587.33, // D5 (tier 6)
  659.25, // E5 (tier 7)
  783.99, // G5 (tier 8)
  880.00, // A5 (tier 9)
  1046.50, // C6 (tier 10)
];

export const COMBO_PITCH_NOTES = ['C5', 'E5', 'G5', 'C6'];
export const COMBO_PITCH_HZ = [
  523.25, // C5 (x1)
  659.25, // E5 (x2)
  783.99, // G5 (x3)
  1046.50, // C6 (x4+)
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
    this.heartbeatCount = 0;
    this.fanfareCount = 0;
    this.starSfxCount = 0;
    this.lastMergeTier = -1;
    this.lastMergePitchHz = 0;
    this.lastComboPitchHz = 0;
    this.lastComboNote = 'C5';
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
    const clampedTier = Math.min(PENTATONIC_HZ.length - 1, Math.max(0, Math.floor(toTier)));
    const tierFreq = PENTATONIC_HZ[clampedTier];
    const comboIdx = Math.min(COMBO_PITCH_HZ.length - 1, Math.max(0, Math.floor(combo) - 1));
    const comboFreq = COMBO_PITCH_HZ[comboIdx];

    this.lastMergeTier = clampedTier;
    this.lastMergePitchHz = tierFreq;
    this.lastComboPitchHz = comboFreq;
    this.lastComboNote = COMBO_PITCH_NOTES[comboIdx];

    // Base merge pop whose pitch rises monotonically with tier
    this._spawnTone({
      freq: tierFreq * 0.82,
      endFreq: tierFreq * 1.28,
      type: 'sine',
      duration: 0.13,
      gain: 0.28,
    });
    // Escalating combo chime (C5 -> E5 -> G5 -> C6)
    this._spawnTone({
      freq: comboFreq,
      endFreq: comboFreq * 1.18,
      type: 'triangle',
      duration: 0.16,
      delay: 0.04,
      gain: combo >= 2 ? 0.26 : 0.18,
    });

    if (toTier >= 10) {
      this.playBigWatermelonFanfare();
    }
  }

  playBigWatermelonFanfare() {
    if (!this._canTriggerSfx('big_melon_fanfare', 80)) return;
    this.sfxCount += 1;
    this.fanfareCount += 1;
    [523.25, 659.25, 783.99, 1046.50, 1318.51, 1567.98].forEach((f, idx) => {
      this._spawnTone({
        freq: f,
        endFreq: f * 1.08,
        type: 'triangle',
        duration: 0.26,
        delay: 0.07 * idx,
        gain: 0.28,
      });
    });
  }

  playGoldenFountain() {
    if (!this._canTriggerSfx('fountain', 80)) return;
    this.sfxCount += 1;
    this.fanfareCount += 1;
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

  playStarUnlock(stars = 1) {
    if (!this._canTriggerSfx('star_unlock', 80)) return;
    this.sfxCount += 1;
    this.starSfxCount += 1;
    const baseNotes = [659.25, 880.0, 1174.66];
    baseNotes.forEach((f, i) => {
      this._spawnTone({
        freq: f * (1 + (stars - 1) * 0.08),
        type: 'triangle',
        duration: 0.18,
        delay: i * 0.05,
        gain: 0.24,
      });
    });
  }

  playHeartbeat(proximity = 0.5) {
    const p = Math.min(1, Math.max(0, Number(proximity) || 0.5));
    const minIntervalMs = Math.round(660 - p * 240);
    if (!this._canTriggerSfx('heartbeat', minIntervalMs)) return;
    this.sfxCount += 1;
    this.heartbeatCount += 1;
    // Two-thump lub-dub heartbeat SFX
    this._spawnTone({
      freq: 92 + p * 16,
      endFreq: 58,
      type: 'sine',
      duration: 0.11,
      gain: 0.24,
    });
    this._spawnTone({
      freq: 108 + p * 22,
      endFreq: 64,
      type: 'triangle',
      duration: 0.12,
      delay: 0.13,
      gain: 0.28,
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
      heartbeatCount: this.heartbeatCount,
      fanfareCount: this.fanfareCount,
      starSfxCount: this.starSfxCount,
      lastMergeTier: this.lastMergeTier,
      lastMergePitchHz: this.lastMergePitchHz,
      lastMergeHz: this.lastMergePitchHz,
      lastComboPitchHz: this.lastComboPitchHz,
      lastComboNote: this.lastComboNote,
      lastMergeNote: this.lastComboNote,
      activeNodes: this.activeNodes,
      contextState: this.ctx ? this.ctx.state : 'uninitialized',
    };
  }
}
