/**
 * @fileoverview Main application controller, pointer/touch/keyboard input bindings,
 * HUD synchronization, and frozen deterministic `window.__WATERMELON__` test seam
 * for Synthetic Big Watermelon 3D (合成大西瓜 3D).
 */

import { WatermelonAudio } from './audio.js';
import { FIXED_DT, FRUIT_TIERS, GAME_MODES, JAR_CONFIG, TOOL_SPECS } from './config.js';
import { WatermelonRenderer } from './renderer.js';
import { WatermelonSimulation } from './sim.js';

function deepClone(obj) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(obj);
    } catch (_) {}
  }
  return JSON.parse(JSON.stringify(obj));
}

class WatermelonApp {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.sim = new WatermelonSimulation();
    this.audio = new WatermelonAudio();
    this.renderer = new WatermelonRenderer(this.canvas);

    this.uiScreen = 'title'; // 'title' | 'playing' | 'podium'
    this.keysDown = new Set();
    this.isPointerDragging = false;
    this.activePointerId = null;
    this.lastProcessedEventIdx = 0;
    this.rafId = null;
    this.lastFrameTime = performance.now();
    this.accumulator = 0;

    this.errors = {
      jsErrors: [],
      unhandledRejections: [],
      resourceErrors: [],
    };

    this._cacheDom();
    this._bindErrorTracking();
    this._bindEvents();

    // Seed a cheerful showcase state on the title screen so the 3D jar is vibrant on load
    this.sim.reset({
      mode: 'classic',
      seed: 20261029,
      customFruits: [
        { tier: 6, x: -1.8, y: 1.2 },
        { tier: 5, x: 1.4, y: 1.02 },
        { tier: 4, x: 0.0, y: 0.86 },
        { tier: 3, x: -0.6, y: 2.3 },
        { tier: 2, x: 0.85, y: 2.2 },
      ],
    });
    this._syncAudioEvents(true);
    this.syncUI();
    this.renderer.render(this.sim.getState(), FIXED_DT);
    this._startLoop();
  }

  _cacheDom() {
    this.dom = {
      titleOverlay: document.getElementById('title-overlay'),
      gameplayHud: document.getElementById('gameplay-hud'),
      podiumOverlay: document.getElementById('podium-overlay'),

      btnStartClassic: document.getElementById('btn-start-classic'),
      btnStartRush: document.getElementById('btn-start-rush'),
      btnTitleAudio: document.getElementById('btn-title-audio'),

      hudScore: document.getElementById('hud-score-value'),
      hudBest: document.getElementById('hud-best-value'),
      hudNextFruit: document.getElementById('hud-next-fruit'),
      hudModeBadge: document.getElementById('hud-mode-badge'),
      hudTimerBadge: document.getElementById('hud-timer-badge'),
      hudComboBanner: document.getElementById('hud-combo-banner'),
      hudWarningBanner: document.getElementById('hud-warning-banner'),
      hudHammerBanner: document.getElementById('hud-hammer-banner'),

      btnShake: document.getElementById('hud-btn-shake'),
      btnHammer: document.getElementById('hud-btn-hammer'),
      btnRainbow: document.getElementById('hud-btn-rainbow'),
      btnMode: document.getElementById('hud-btn-mode'),
      btnAudio: document.getElementById('hud-btn-audio'),
      btnHome: document.getElementById('hud-btn-home'),

      cntShake: document.getElementById('cnt-shake'),
      cntHammer: document.getElementById('cnt-hammer'),
      cntRainbow: document.getElementById('cnt-rainbow'),

      podiumTitle: document.getElementById('podium-title'),
      podiumStarsText: document.getElementById('podium-stars-text'),
      podiumScore: document.getElementById('podium-score-value'),
      podiumRankBadge: document.getElementById('podium-rank-badge'),
      podiumWatermelons: document.getElementById('podium-watermelons-value'),
      btnPlayAgain: document.getElementById('btn-play-again'),
      btnPodiumHome: document.getElementById('btn-podium-home'),
    };
  }

  _bindErrorTracking() {
    window.addEventListener(
      'error',
      (ev) => {
        if (ev && ev.target && ev.target !== window) {
          this.errors.resourceErrors.push(
            String(ev.target.src || ev.target.href || ev.target.tagName || 'resource')
          );
        } else if (ev) {
          this.errors.jsErrors.push(String(ev.message || ev));
        }
      },
      true
    );
    window.addEventListener('unhandledrejection', (ev) => {
      this.errors.unhandledRejections.push(String(ev?.reason || 'rejection'));
    });
  }

  _bindEvents() {
    window.addEventListener('resize', () => {
      this.renderer.resize();
      this.renderer.render(this.sim.getState(), 0);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.keysDown.clear();
      }
    });

    // Title Screen Buttons
    this.dom.btnStartClassic?.addEventListener('click', (ev) => {
      this.audio.unlock(ev);
      this.startMatch({ mode: 'classic' });
    });
    this.dom.btnStartRush?.addEventListener('click', (ev) => {
      this.audio.unlock(ev);
      this.startMatch({ mode: 'rush' });
    });
    this.dom.btnTitleAudio?.addEventListener('click', (ev) => {
      this.audio.unlock(ev);
      this.audio.toggleMute();
      this.syncUI();
    });

    // Gameplay HUD Buttons (exactly 6 controls, each >= 72x72px)
    this.dom.btnShake?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.audio.unlock(ev);
      this.useTool('shake');
    });
    this.dom.btnHammer?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.audio.unlock(ev);
      this.useTool('hammer', 'arm');
    });
    this.dom.btnRainbow?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.audio.unlock(ev);
      this.useTool('rainbow');
    });
    this.dom.btnMode?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.audio.unlock(ev);
      const nextMode = this.sim.mode === 'classic' ? 'rush' : 'classic';
      this.startMatch({ mode: nextMode, seed: (this.sim.seed + 1) >>> 0 });
    });
    this.dom.btnAudio?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.audio.unlock(ev);
      this.audio.toggleMute();
      this.syncUI();
    });
    this.dom.btnHome?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.audio.unlock(ev);
      this.openTitle();
    });

    // Podium Overlay Buttons
    this.dom.btnPlayAgain?.addEventListener('click', (ev) => {
      this.audio.unlock(ev);
      this.startMatch({ mode: this.sim.mode, seed: (this.sim.seed + 7) >>> 0 });
    });
    this.dom.btnPodiumHome?.addEventListener('click', (ev) => {
      this.audio.unlock(ev);
      this.openTitle();
    });

    // 1:1 Pointer / Touch Horizontal Drag over 3D Jar + Release to Drop + 3D Raycast Hammer
    this.hammerGestureConsumed = false;
    this.canvas.addEventListener('pointerdown', (ev) => {
      this.audio.unlock(ev);
      if (this.uiScreen !== 'playing') return;

      const hit = this.renderer.raycastJar(ev.clientX, ev.clientY);

      // If Magic Hammer is armed, tapping a 3D fruit smashes it via 3D raycast
      // and marks the pointer/touch gesture consumed so pointerup never drops the held fruit!
      if (this.sim.activeTool === 'hammer') {
        this.isPointerDragging = false;
        this.activePointerId = null;
        this.hammerGestureConsumed = true;
        if (hit.hitFruitId !== null) {
          this.useTool('hammer', hit.hitFruitId);
        } else {
          this.useTool('hammer', 'auto');
        }
        return;
      }

      this.hammerGestureConsumed = false;
      this.isPointerDragging = true;
      this.activePointerId = ev.pointerId;
      this.sim.setAimX(hit.worldX);
      this.syncUI();
      this._renderCoalesced(0, true);
    });

    window.addEventListener('pointermove', (ev) => {
      if (!this.isPointerDragging || this.hammerGestureConsumed || this.uiScreen !== 'playing') {
        return;
      }
      if (this.activePointerId !== null && ev.pointerId !== this.activePointerId) return;
      const hit = this.renderer.raycastJar(ev.clientX, ev.clientY);
      this.sim.setAimX(hit.worldX);
      this._renderCoalesced(0, false);
    });

    const finishPointerDrop = (ev) => {
      if (this.hammerGestureConsumed) {
        this.hammerGestureConsumed = false;
        this.isPointerDragging = false;
        this.activePointerId = null;
        return;
      }
      if (!this.isPointerDragging) return;
      if (this.activePointerId !== null && ev.pointerId !== this.activePointerId) return;
      this.isPointerDragging = false;
      this.activePointerId = null;
      if (this.uiScreen === 'playing' && this.sim.activeTool !== 'hammer') {
        const hit = this.renderer.raycastJar(ev.clientX, ev.clientY);
        this.sim.setAimX(hit.worldX);
        this.sim.dropFruit({ respectCooldown: true });
        this._syncAudioEvents();
        this.syncUI();
        this._renderCoalesced(0, true);
      }
    };
    window.addEventListener('pointerup', finishPointerDrop);
    window.addEventListener('pointercancel', () => {
      this.hammerGestureConsumed = false;
      this.isPointerDragging = false;
      this.activePointerId = null;
    });

    // Desktop Keyboard Controls (idempotent against keydown ev.repeat!)
    window.addEventListener('keydown', (ev) => {
      if (ev.repeat) {
        // Strictly ignore key repeat floods for discrete actions & audio unlock
        return;
      }
      this.audio.unlock(ev);
      this.keysDown.add(ev.code);

      if (this.uiScreen === 'title') {
        if (ev.code === 'Space' || ev.code === 'Enter') {
          ev.preventDefault();
          this.startMatch({ mode: 'classic' });
        }
        return;
      }

      if (this.uiScreen === 'podium') {
        if (ev.code === 'Space' || ev.code === 'Enter') {
          ev.preventDefault();
          this.startMatch({ mode: this.sim.mode, seed: (this.sim.seed + 7) >>> 0 });
        }
        return;
      }

      if (ev.code === 'Space' || ev.code === 'Enter' || ev.code === 'ArrowDown' || ev.code === 'KeyS') {
        ev.preventDefault();
        this.sim.dropFruit({ respectCooldown: true });
        this._syncAudioEvents();
        this.syncUI();
      } else if (ev.code === 'ArrowLeft' || ev.code === 'KeyA') {
        this.sim.setAimX(this.sim.aimX - 0.55);
      } else if (ev.code === 'ArrowRight' || ev.code === 'KeyD') {
        this.sim.setAimX(this.sim.aimX + 0.55);
      } else if (ev.code === 'Digit1' || ev.code === 'KeyQ') {
        this.useTool('shake');
      } else if (ev.code === 'Digit2' || ev.code === 'KeyW') {
        this.useTool('hammer', 'auto');
      } else if (ev.code === 'Digit3' || ev.code === 'KeyE') {
        this.useTool('rainbow');
      } else if (ev.code === 'KeyM') {
        this.audio.toggleMute();
        this.syncUI();
      }
    });

    window.addEventListener('keyup', (ev) => {
      this.keysDown.delete(ev.code);
    });
  }

  _startLoop() {
    const tick = (now) => {
      this.rafId = window.requestAnimationFrame(tick);
      const dt = Math.min(0.1, Math.max(0, (now - this.lastFrameTime) / 1000));
      this.lastFrameTime = now;

      if (this.uiScreen === 'playing' && this.sim.status === 'playing') {
        // Continuous smooth keyboard horizontal aim
        let moveDir = 0;
        if (this.keysDown.has('ArrowLeft') || this.keysDown.has('KeyA')) moveDir -= 1;
        if (this.keysDown.has('ArrowRight') || this.keysDown.has('KeyD')) moveDir += 1;
        if (moveDir !== 0) {
          this.sim.setAimX(this.sim.aimX + moveDir * 7.5 * dt);
        }

        this.accumulator += dt;
        while (this.accumulator >= FIXED_DT) {
          this.sim.stepFrames(1);
          this.accumulator -= FIXED_DT;
          if (this.sim.status === 'podium') {
            this.uiScreen = 'podium';
            break;
          }
        }
        this._syncAudioEvents();
        this.syncUI();
      }

      this.renderer.render(this.sim.getState(), dt || FIXED_DT);
    };
    this.rafId = window.requestAnimationFrame(tick);
  }

  _syncAudioEvents(silent = false) {
    const events = this.sim.events;
    if (silent) {
      this.lastProcessedEventIdx = events.length;
      return;
    }
    while (this.lastProcessedEventIdx < events.length) {
      const ev = events[this.lastProcessedEventIdx++];
      if (!ev) continue;
      switch (ev.type) {
        case 'drop':
          this.audio.playDrop();
          break;
        case 'bounce':
          this.audio.playBounce(ev.tier);
          break;
        case 'merge':
          this.audio.playMerge(ev.toTier, ev.combo);
          break;
        case 'golden_watermelon_fountain':
          this.audio.playGoldenFountain();
          break;
        case 'tool_shake':
          this.audio.playTool('shake');
          break;
        case 'tool_hammer_smash':
          this.audio.playTool('hammer');
          break;
        case 'tool_rainbow':
          this.audio.playTool('rainbow');
          break;
        case 'match_end':
          this.audio.playPodium(ev.stars);
          break;
        default:
          break;
      }
    }
    if (this.sim.maxOverflowTimer > 0.35) {
      this.audio.playWarning();
    }
  }

  openTitle() {
    this.uiScreen = 'title';
    this.syncUI();
    this._renderCoalesced(0, true);
    return this.getState();
  }

  startMatch(opts = {}) {
    this.sim.reset(opts);
    this.uiScreen = opts.status === 'title' ? 'title' : 'playing';
    this.lastProcessedEventIdx = this.sim.events.length;
    this.accumulator = 0;
    this.syncUI();
    this._renderCoalesced(0, true);
    return this.getState();
  }

  stepFrames(n = 1) {
    if (this.uiScreen === 'title' && this.sim.status === 'playing') {
      this.uiScreen = 'playing';
    }
    const frames = Math.max(1, Math.floor(Number(n) || 1));
    this.sim.stepFrames(frames);
    if (this.sim.status === 'podium') {
      this.uiScreen = 'podium';
    }
    this._syncAudioEvents();
    this.syncUI();
    this._renderCoalesced(frames * FIXED_DT, false);
    return this.getState();
  }

  setAimX(x) {
    if (this.uiScreen === 'title') {
      this.uiScreen = 'playing';
    }
    this.sim.setAimX(x);
    this.syncUI();
    this._renderCoalesced(0, false);
    return this.getState();
  }

  dropFruit() {
    if (this.uiScreen === 'title') {
      this.uiScreen = 'playing';
    }
    this.sim.dropFruit();
    this._syncAudioEvents();
    this.syncUI();
    this._renderCoalesced(0, false);
    return this.getState();
  }

  useTool(type, targetId) {
    if (this.uiScreen === 'title') {
      this.uiScreen = 'playing';
    }
    this.sim.useTool(type, targetId);
    this._syncAudioEvents();
    this.syncUI();
    this._renderCoalesced(0, true);
    return this.getState();
  }

  _renderCoalesced(simDt = FIXED_DT, forceDraw = false) {
    const now = performance.now();
    const shouldDraw = forceDraw || !this.lastDrawWallMs || now - this.lastDrawWallMs >= 14;
    if (shouldDraw) {
      this.lastDrawWallMs = now;
    }
    this.renderer.render(this.sim.getState(), simDt, shouldDraw);
  }

  syncUI() {
    const st = this.sim.getState();
    if (st.status === 'podium' && this.uiScreen === 'playing') {
      this.uiScreen = 'podium';
    }

    // Exclusively show only ONE screen overlay/HUD so visible button count is always <= 6
    if (this.dom.titleOverlay) {
      this.dom.titleOverlay.hidden = this.uiScreen !== 'title';
    }
    if (this.dom.gameplayHud) {
      this.dom.gameplayHud.hidden = this.uiScreen !== 'playing';
    }
    if (this.dom.podiumOverlay) {
      this.dom.podiumOverlay.hidden = this.uiScreen !== 'podium';
    }

    // Score & Next Fruit
    if (this.dom.hudScore) this.dom.hudScore.textContent = String(st.score);
    if (this.dom.hudBest) this.dom.hudBest.textContent = String(st.bestScore);
    if (this.dom.hudNextFruit && st.nextFruit) {
      this.dom.hudNextFruit.textContent = `下一颗: ${st.nextFruit.nameZh}`;
    }

    // Mode & Timer Badges
    const modeSpec = GAME_MODES[st.mode] || GAME_MODES.classic;
    if (this.dom.hudModeBadge) {
      this.dom.hudModeBadge.textContent = modeSpec.nameZh;
    }
    if (this.dom.hudTimerBadge) {
      if (st.mode === 'rush' && typeof st.timeRemaining === 'number') {
        this.dom.hudTimerBadge.hidden = false;
        const sec = Math.ceil(st.timeRemaining);
        const mm = String(Math.floor(sec / 60)).padStart(2, '0');
        const ss = String(sec % 60).padStart(2, '0');
        this.dom.hudTimerBadge.textContent = `⏳ ${mm}:${ss}`;
      } else {
        this.dom.hudTimerBadge.hidden = true;
      }
    }

    // Combo Banner
    if (this.dom.hudComboBanner) {
      if (st.comboCount >= 2 && st.comboTimer > 0) {
        this.dom.hudComboBanner.hidden = false;
        this.dom.hudComboBanner.textContent = `🔥 连击 Combo x${st.comboCount}!`;
      } else {
        this.dom.hudComboBanner.hidden = true;
      }
    }

    // Overflow Warning Banner
    if (this.dom.hudWarningBanner) {
      if (st.maxOverflowTimer > 0.05) {
        this.dom.hudWarningBanner.hidden = false;
        const left = Math.max(0, st.overflowLimitSec - st.maxOverflowTimer).toFixed(1);
        this.dom.hudWarningBanner.textContent = `⚠️ 满杯警戒 ${left}s`;
      } else {
        this.dom.hudWarningBanner.hidden = true;
      }
    }

    // Hammer Armed Banner
    if (this.dom.hudHammerBanner) {
      this.dom.hudHammerBanner.hidden = st.activeTool !== 'hammer';
    }

    // Tool Charge Badges & Active Highlight
    if (this.dom.cntShake) this.dom.cntShake.textContent = String(st.tools.shake);
    if (this.dom.cntHammer) this.dom.cntHammer.textContent = String(st.tools.hammer);
    if (this.dom.cntRainbow) this.dom.cntRainbow.textContent = String(st.tools.rainbow);
    if (this.dom.btnHammer) {
      this.dom.btnHammer.classList.toggle('tool-armed', st.activeTool === 'hammer');
    }

    // Audio Buttons
    const audioIcon = this.audio.muted ? '🔇' : '🔊';
    if (this.dom.btnAudio) {
      this.dom.btnAudio.textContent = `${audioIcon}`;
      this.dom.btnAudio.setAttribute('aria-label', this.audio.muted ? '开启声音' : '静音');
    }
    if (this.dom.btnTitleAudio) {
      this.dom.btnTitleAudio.textContent = `${audioIcon} ${this.audio.muted ? '开启音乐' : '音乐开启'}`;
    }

    // Mode Switch Button Label
    if (this.dom.btnMode) {
      this.dom.btnMode.innerHTML =
        st.mode === 'classic'
          ? '<span class="btn-icon">⚡</span><span class="btn-txt">冲刺</span>'
          : '<span class="btn-icon">🍉</span><span class="btn-txt">经典</span>';
    }

    // Podium Screen Content
    if (this.uiScreen === 'podium') {
      const starsStr =
        st.stars > 0 ? '⭐'.repeat(st.stars) + '☆'.repeat(3 - st.stars) : '☆☆☆ 再接再厉';
      if (this.dom.podiumStarsText) this.dom.podiumStarsText.textContent = starsStr;
      if (this.dom.podiumScore) this.dom.podiumScore.textContent = String(st.score);
      if (this.dom.podiumWatermelons) {
        this.dom.podiumWatermelons.textContent = String(st.watermelonsCreated);
      }
      if (this.dom.podiumRankBadge) {
        const rankLabels = {
          1: '🥇 冠军领奖台 (3星满贯!)',
          2: '🥈 亚军领奖台 (2星达人!)',
          3: '🥉 季军领奖台 (1星合格!)',
          4: '💪 差一点就登上领奖台啦!',
        };
        this.dom.podiumRankBadge.textContent = rankLabels[st.podiumRank] || rankLabels[4];
      }
      if (this.dom.podiumTitle) {
        this.dom.podiumTitle.textContent =
          st.endReason === 'timeout' ? '⏰ 限时冲刺结束!' : '🍉 合成结算领奖台';
      }
    }
  }

  getState() {
    const simState = this.sim.getState();
    return deepClone({
      ...simState,
      uiScreen: this.uiScreen,
      webgl2: this.renderer.webgl2Supported,
      audio: this.audio.getDiagnostics(),
      fruitTiers: FRUIT_TIERS.map((t) => ({
        tier: t.tier,
        id: t.id,
        nameZh: t.nameZh,
        nameEn: t.nameEn,
        radius: t.radius,
        score: t.score,
      })),
      toolSpecs: TOOL_SPECS,
      errors: this.errors,
    });
  }
}

const app = new WatermelonApp();

const publicApi = Object.freeze({
  startMatch: (opts) => app.startMatch(opts),
  stepFrames: (n) => app.stepFrames(n),
  setAimX: (x) => app.setAimX(x),
  dropFruit: () => app.dropFruit(),
  useTool: (type, targetId) => app.useTool(type, targetId),
  openTitle: () => app.openTitle(),
  getState: () => app.getState(),
});

Object.defineProperty(window, '__WATERMELON__', {
  value: publicApi,
  writable: false,
  configurable: false,
  enumerable: true,
});
