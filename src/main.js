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
    this.lastPopupText = '';
    this.lastPopupComboText = '';
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
        { tier: 5, x: -1.4, y: 1.16 },
        { tier: 4, x: 1.1, y: 0.96 },
        { tier: 3, x: -0.1, y: 0.78 },
        { tier: 2, x: -0.5, y: 2.1 },
        { tier: 1, x: 0.65, y: 2.0 },
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
      hudStarBar: document.getElementById('hud-star-bar'),
      hudStarFill: document.getElementById('hud-star-fill'),
      starMark1: document.getElementById('star-mark-1'),
      starMark2: document.getElementById('star-mark-2'),
      starMark3: document.getElementById('star-mark-3'),
      hudDangerStamp: document.getElementById('hud-danger-stamp'),
      hudComboBanner: document.getElementById('hud-combo-banner'),
      hudWarningBanner: document.getElementById('hud-warning-banner'),
      hudHammerBanner: document.getElementById('hud-hammer-banner'),
      hudPopups: document.getElementById('hud-popups'),

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
      podiumNewRecord: document.getElementById('podium-new-record'),
      podiumStarsText: document.getElementById('podium-stars-text'),
      podiumScore: document.getElementById('podium-score-value'),
      podiumRankBadge: document.getElementById('podium-rank-badge'),
      podiumWatermelons: document.getElementById('podium-watermelons-value'),
      btnPlayAgain: document.getElementById('btn-play-again'),
      btnPodiumMode: document.getElementById('btn-podium-mode'),
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

    // Gameplay HUD Buttons (strictly 5 controls during play, each >= 70x70px)
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
    this.dom.btnPodiumMode?.addEventListener('click', (ev) => {
      this.audio.unlock(ev);
      const nextMode = this.sim.mode === 'classic' ? 'rush' : 'classic';
      this.startMatch({ mode: nextMode, seed: (this.sim.seed + 1) >>> 0 });
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

  _spawnMergePopup(ev) {
    const ptsStr = `+${ev.scoreGained || ev.bonus || 0}`;
    this.lastPopupText = ptsStr;
    if (ev.combo && ev.combo >= 2) {
      this.lastPopupComboText = `×${ev.combo}`;
    }
    if (!this.dom.hudPopups) return;
    const now = performance.now();
    if (
      this.lastPopupWallMs &&
      now - this.lastPopupWallMs < 14 &&
      this.dom.hudPopups.lastElementChild
    ) {
      const lastEl = this.dom.hudPopups.lastElementChild;
      const screenPt = this.renderer.worldToScreen(ev.x || 0, ev.y || 3, 0.35);
      lastEl.style.left = `${Math.round(screenPt.x)}px`;
      lastEl.style.top = `${Math.round(screenPt.y)}px`;
      lastEl.innerHTML = '';
      if (ev.combo && ev.combo >= 2) {
        const comboEl = document.createElement('div');
        comboEl.className = 'merge-popup-combo';
        comboEl.textContent = `×${ev.combo}`;
        lastEl.appendChild(comboEl);
      }
      const ptsEl = document.createElement('div');
      ptsEl.className = 'merge-popup-pts';
      ptsEl.textContent = ev.isBigWatermelon ? `🍉 ${ptsStr}` : ptsStr;
      lastEl.appendChild(ptsEl);
      return;
    }
    this.lastPopupWallMs = now;
    while (this.dom.hudPopups.children.length >= 6) {
      this.dom.hudPopups.removeChild(this.dom.hudPopups.firstChild);
    }
    const screenPt = this.renderer.worldToScreen(ev.x || 0, ev.y || 3, 0.35);
    const el = document.createElement('div');
    el.className = 'merge-popup';
    el.style.left = `${Math.round(screenPt.x)}px`;
    el.style.top = `${Math.round(screenPt.y)}px`;

    if (ev.combo && ev.combo >= 2) {
      const comboEl = document.createElement('div');
      comboEl.className = 'merge-popup-combo';
      comboEl.textContent = `×${ev.combo}`;
      el.appendChild(comboEl);
    }

    const ptsEl = document.createElement('div');
    ptsEl.className = 'merge-popup-pts';
    ptsEl.textContent = ev.isBigWatermelon ? `🍉 ${ptsStr}` : ptsStr;
    el.appendChild(ptsEl);

    this.dom.hudPopups.appendChild(el);
    window.setTimeout(() => {
      if (el.parentNode === this.dom.hudPopups) {
        this.dom.hudPopups.removeChild(el);
      }
    }, 1150);
  }

  _triggerStarPop(stars) {
    const marks = [this.dom.starMark1, this.dom.starMark2, this.dom.starMark3];
    for (let i = 0; i < stars && i < marks.length; i++) {
      const el = marks[i];
      if (!el) continue;
      el.classList.remove('star-pop');
      // Force reflow for animation restart
      void el.offsetWidth;
      el.classList.add('star-pop');
    }
  }

  _syncAudioEvents(silent = false) {
    const events = this.sim.consumeEvents();
    if (silent) {
      return;
    }
    for (const ev of events) {
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
          this._spawnMergePopup(ev);
          break;
        case 'big_watermelon_celebration':
          this.audio.playBigWatermelonFanfare();
          break;
        case 'golden_watermelon_fountain':
          this.audio.playGoldenFountain();
          this._spawnMergePopup(ev);
          break;
        case 'star_unlocked':
          this.audio.playStarUnlock(ev.stars);
          this._triggerStarPop(ev.stars);
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
    if (this.sim.nearRimDanger) {
      this.audio.playHeartbeat(this.sim.dangerProximity);
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
    if (this.dom.hudPopups) {
      this.dom.hudPopups.innerHTML = '';
    }
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
      this.renderer.render(this.sim.getState(), simDt, true);
    } else {
      this.pendingRenderDt = (this.pendingRenderDt || 0) + simDt;
    }
  }

  syncUI() {
    const st = this.sim.getState();
    if (st.status === 'podium' && this.uiScreen === 'playing') {
      this.uiScreen = 'podium';
    }

    // Exclusively show only ONE screen overlay/HUD so visible button count is always <= 5
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

    // Star Progress Bar (3000 / 8000 / 15000 classic)
    if (this.dom.hudStarFill) {
      const pct = Math.min(100, Math.max(0, Math.round((st.starProgress || 0) * 100)));
      this.dom.hudStarFill.style.width = `${pct}%`;
    }
    const thresholds = st.starThresholds || [3000, 8000, 15000];
    const marks = [this.dom.starMark1, this.dom.starMark2, this.dom.starMark3];
    for (let i = 0; i < marks.length; i++) {
      const el = marks[i];
      if (!el) continue;
      const earned = st.stars >= i + 1;
      el.textContent = `${earned ? '⭐' : '★'}${thresholds[i] || ''}`;
      el.classList.toggle('star-earned', earned);
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

    // "危险!" Stamp when overflowTimer > 0.8s
    if (this.dom.hudDangerStamp) {
      this.dom.hudDangerStamp.hidden = !st.dangerStampActive;
      this.dom.hudDangerStamp.classList.toggle('visible', Boolean(st.dangerStampActive));
      this.dom.hudDangerStamp.textContent = '危险!';
    }

    // Combo Banner
    if (this.dom.hudComboBanner) {
      if (st.comboCount >= 2 && st.comboTimer > 0) {
        this.dom.hudComboBanner.hidden = false;
        this.dom.hudComboBanner.textContent = `🔥 连击 Combo ×${st.comboCount}!`;
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

    // Podium Mode Switch Button Label
    if (this.dom.btnPodiumMode) {
      this.dom.btnPodiumMode.textContent =
        st.mode === 'classic' ? '⚡ 限时冲刺' : '🍉 经典合成';
    }

    // Podium Screen Content
    if (this.uiScreen === 'podium') {
      if (this.dom.podiumNewRecord) {
        this.dom.podiumNewRecord.hidden = !st.isNewRecord;
        this.dom.podiumNewRecord.classList.toggle('visible', Boolean(st.isNewRecord));
      }
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
      jarScreenRect: this.renderer.getJarScreenRect(),
      grapePixelDiameter: this.renderer.getGrapePixelDiameter(),
      penguinHoldingTier:
        typeof simState.nextFruitTier === 'number'
          ? simState.nextFruitTier
          : this.renderer.penguinNextTier,
      activePopups: this.dom.hudPopups ? this.dom.hudPopups.children.length : 0,
      lastPopupText: this.lastPopupText,
      lastPopupComboText: this.lastPopupComboText,
      fruitTiers: FRUIT_TIERS.map((t) => ({
        tier: t.tier,
        id: t.id,
        nameZh: t.nameZh,
        nameEn: t.nameEn,
        radius: t.radius,
        mass: t.mass,
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
