/**
 * @fileoverview Deterministic 240Hz substepped rigid-body jar physics and
 * 11-tier fruit merge simulation engine for Synthetic Big Watermelon 3D (合成大西瓜 3D).
 */

import {
  FIXED_DT,
  FRUIT_TIERS,
  GAME_MODES,
  JAR_CONFIG,
  MAX_SPAWN_TIER,
  MERGE_COOLDOWN_SEC,
  PHYSICS_SUBSTEPS,
  RELAXATION_ITERS,
  TOOL_SPECS,
} from './config.js';

/**
 * Mulberry32 deterministic seeded PRNG returning floats in [0, 1).
 * @param {number} seed
 * @return {function(): number}
 */
export function createMulberry32(seed = 20261029) {
  let a = (Number(seed) || 20261029) >>> 0;
  return function nextRandom() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v, min, max) {
  if (!Number.isFinite(v)) return (min + max) * 0.5;
  return v < min ? min : v > max ? max : v;
}

function sanitizeFinite(v, fallback = 0) {
  return Number.isFinite(v) ? v : fallback;
}

export class WatermelonSimulation {
  constructor() {
    this.bestScore = 0;
    this.reset();
  }

  /**
   * Initializes or restarts a match with deterministic seed and optional overrides.
   * Zero score-faking backdoors: score always starts at 0 and is earned via real merges/pops.
   * @param {Object=} opts
   */
  reset(opts = {}) {
    const modeId = opts.mode && GAME_MODES[opts.mode] ? opts.mode : 'classic';
    const modeSpec = GAME_MODES[modeId];
    this.mode = modeId;
    this.seed = Number.isFinite(Number(opts.seed))
      ? Number(opts.seed) >>> 0
      : 20261029;
    this.rng = createMulberry32(this.seed);

    this.status = opts.status === 'title' ? 'title' : 'playing';
    this.frame = 0;
    this.elapsedSec = 0;
    this.timeRemaining =
      typeof opts.timeRemaining === 'number'
        ? opts.timeRemaining
        : modeSpec.durationSec;

    this.score = 0;
    this.stars = 0;
    this.podiumRank = 4;
    this.endReason = null;

    this.nextEntityId = 1;
    this.forcedQueue = Array.isArray(opts.forcedQueue)
      ? opts.forcedQueue.map((t) =>
          clamp(Math.floor(Number(t)), 0, FRUIT_TIERS.length - 1)
        )
      : [];

    this.fruits = [];
    this.highestTier = 0;
    this.mergeCount = 0;
    this.comboCount = 0;
    this.maxCombo = 0;
    this.comboTimer = 0;
    this.watermelonsCreated = 0;
    this.goldenMelonBonuses = 0;
    this.maxOverflowTimer = 0;
    this.dropCount = 0;

    this.tools = {
      shake:
        typeof opts.tools?.shake === 'number'
          ? Math.max(0, Math.floor(opts.tools.shake))
          : modeSpec.initialTools.shake,
      hammer:
        typeof opts.tools?.hammer === 'number'
          ? Math.max(0, Math.floor(opts.tools.hammer))
          : modeSpec.initialTools.hammer,
      rainbow:
        typeof opts.tools?.rainbow === 'number'
          ? Math.max(0, Math.floor(opts.tools.rainbow))
          : modeSpec.initialTools.rainbow,
    };
    this.activeTool = null;
    this.shakeTimer = 0;
    this.dropCooldown = 0;
    this.events = [];

    const firstTier = this._drawNextSpawnTier();
    const secondTier = this._drawNextSpawnTier();
    this.currentFruit = this._makeHeldFruit(firstTier);
    this.nextFruitTier = secondTier;
    this.aimX = 0;
    this.setAimX(typeof opts.aimX === 'number' ? opts.aimX : 0);

    if (Array.isArray(opts.customFruits)) {
      for (const cf of opts.customFruits) {
        const tier = clamp(
            Math.floor(Number(cf.tier ?? 0)),
            0,
            FRUIT_TIERS.length - 1
        );
        const spec = FRUIT_TIERS[tier];
        const r = spec.radius;
        const x = clamp(
            Number(cf.x ?? 0),
            -JAR_CONFIG.halfWidth + r,
            JAR_CONFIG.halfWidth - r
        );
        const y = Math.max(JAR_CONFIG.floorY + r, Number(cf.y ?? r));
        const vx = sanitizeFinite(Number(cf.vx ?? 0), 0);
        const fruit = {
          id: this.nextEntityId++,
          tier,
          nameZh: spec.nameZh,
          nameEn: spec.nameEn,
          x,
          y,
          z: 0,
          vx,
          vy: sanitizeFinite(Number(cf.vy ?? 0), 0),
          radius: r,
          mass: spec.mass,
          angle: sanitizeFinite(Number(cf.angle ?? 0), 0),
          omega: sanitizeFinite(
              Number(cf.omega ?? (Math.abs(vx) > 0.01 ? -vx / r : 0)),
              0
          ),
          graceTimer:
            typeof cf.graceTimer === 'number'
              ? Math.max(0, Number(cf.graceTimer))
              : 0,
          overflowTimer:
            typeof cf.overflowTimer === 'number'
              ? Math.max(0, Number(cf.overflowTimer))
              : 0,
          mergeCooldown: 0,
          hasSettled: Boolean(cf.hasSettled ?? true),
          spawnScale: 1.0,
          wobbleTimer: 0,
          mergedFrom: false,
        };
        this.fruits.push(fruit);
        if (tier > this.highestTier) {
          this.highestTier = tier;
        }
      }
    }

    this._updateOverflowMetrics(0);
    return this.getState();
  }

  _drawNextSpawnTier() {
    if (this.forcedQueue.length > 0) {
      return this.forcedQueue.shift();
    }
    const roll = this.rng();
    if (roll < 0.30) return 0; // Grape
    if (roll < 0.56) return 1; // Cherry
    if (roll < 0.76) return 2; // Mandarin
    if (roll < 0.90) return 3; // Lemon
    return Math.min(4, MAX_SPAWN_TIER); // Kiwi
  }

  _makeHeldFruit(tier) {
    const cleanTier = clamp(Math.floor(Number(tier)), 0, FRUIT_TIERS.length - 1);
    const spec = FRUIT_TIERS[cleanTier];
    return {
      tier: cleanTier,
      id: spec.id,
      nameZh: spec.nameZh,
      nameEn: spec.nameEn,
      radius: spec.radius,
      score: spec.score,
    };
  }

  /**
   * Sets the horizontal aim coordinate, clamped so the held fruit stays inside jar walls.
   * @param {number} x
   */
  setAimX(x) {
    const r = this.currentFruit ? this.currentFruit.radius : FRUIT_TIERS[0].radius;
    const limit = Math.max(0.1, JAR_CONFIG.halfWidth - r - 0.04);
    this.aimX = clamp(Number(x), -limit, limit);
    return this.aimX;
  }

  /**
   * Drops the currently held fruit at (aimX, spawnY) into the jar.
   * Zero tier/coord override backdoors: always drops `currentFruit` at `aimX`.
   * @param {Object=} opts
   * @return {Object|null}
   */
  dropFruit(opts = {}) {
    if (this.status !== 'playing' || !this.currentFruit) {
      return null;
    }
    if (opts && opts.respectCooldown && this.dropCooldown > 0) {
      return null;
    }

    const tier = this.currentFruit.tier;
    const spec = FRUIT_TIERS[tier];
    const r = spec.radius;
    const spawnX = clamp(
        this.aimX,
        -JAR_CONFIG.halfWidth + r + 0.02,
        JAR_CONFIG.halfWidth - r - 0.02
    );
    const spawnY = JAR_CONFIG.spawnY;

    for (const existing of this.fruits) {
      const dy = spawnY - existing.y;
      const dx = spawnX - existing.x;
      const minSep = r + existing.radius;
      if (Math.hypot(dx, dy) < minSep * 0.95 && existing.y > JAR_CONFIG.rimY - 1.5) {
        existing.y = Math.max(
            JAR_CONFIG.floorY + existing.radius,
            existing.y - minSep * 0.65
        );
      }
    }

    const microJitter = (this.rng() - 0.5) * 0.04;
    const spawned = {
      id: this.nextEntityId++,
      tier,
      nameZh: spec.nameZh,
      nameEn: spec.nameEn,
      x: spawnX,
      y: spawnY,
      z: 0,
      vx: microJitter,
      vy: -2.2,
      radius: r,
      mass: spec.mass,
      angle: 0,
      omega: -microJitter / r,
      graceTimer: JAR_CONFIG.spawnGraceSec,
      overflowTimer: 0,
      mergeCooldown: 0,
      hasSettled: false,
      spawnScale: 0.88,
      wobbleTimer: 0.18,
      mergedFrom: false,
    };
    this.fruits.push(spawned);
    this.dropCount += 1;
    if (tier > this.highestTier) {
      this.highestTier = tier;
    }

    const nextTier = this.nextFruitTier;
    this.currentFruit = this._makeHeldFruit(nextTier);
    this.nextFruitTier = this._drawNextSpawnTier();
    this.setAimX(this.aimX);

    this.dropCooldown =
      this.mode === 'rush'
        ? JAR_CONFIG.rushDropCooldownSec
        : JAR_CONFIG.dropCooldownSec;

    this._pushEvent({
      type: 'drop',
      fruitId: spawned.id,
      tier: spawned.tier,
      x: spawned.x,
      y: spawned.y,
    });

    return spawned;
  }

  /**
   * Activates one of the 3 power-up tools: 'shake', 'hammer', or 'rainbow'.
   * @param {string} type
   * @param {number|string=} targetId
   * @return {boolean}
   */
  useTool(type, targetId) {
    if (this.status !== 'playing') return false;
    const cleanType = String(type || '').toLowerCase();

    if (cleanType === 'shake') {
      if (this.tools.shake <= 0) return false;
      this.tools.shake -= 1;
      this.activeTool = null;
      this.shakeTimer = 0.55;

      for (let i = 0; i < this.fruits.length; i++) {
        const f = this.fruits[i];
        const dir = i % 2 === 0 ? 1 : -1;
        const joltX = dir * (4.2 + this.rng() * 3.2) - f.x * 0.65;
        const joltY = 7.5 + this.rng() * 4.5;
        f.vx = clamp(f.vx + joltX, -JAR_CONFIG.maxSpeed, JAR_CONFIG.maxSpeed);
        f.vy = clamp(f.vy + joltY, -JAR_CONFIG.maxSpeed, JAR_CONFIG.maxSpeed);
        f.omega = clamp(f.omega + dir * 3.5, -14, 14);
        f.graceTimer = Math.max(f.graceTimer, 0.85);
        f.overflowTimer = Math.max(0, f.overflowTimer - 0.8);
      }
      this._pushEvent({ type: 'tool_shake', remaining: this.tools.shake });
      return true;
    }

    if (cleanType === 'rainbow') {
      if (this.tools.rainbow <= 0 || !this.currentFruit) return false;
      const oldTier = this.currentFruit.tier;
      const maxUpgradableTier = FRUIT_TIERS.length - 2; // Up to Half-Melon (tier 9)
      if (oldTier >= maxUpgradableTier) {
        // Already at maximum upgradable held tier; do not burn a charge!
        return false;
      }
      this.tools.rainbow -= 1;
      this.activeTool = null;
      const upgradedTier = oldTier + 1;
      this.currentFruit = this._makeHeldFruit(upgradedTier);
      this.setAimX(this.aimX);
      if (upgradedTier > this.highestTier) {
        this.highestTier = upgradedTier;
      }
      this._pushEvent({
        type: 'tool_rainbow',
        oldTier,
        newTier: upgradedTier,
        remaining: this.tools.rainbow,
      });
      return true;
    }

    if (cleanType === 'hammer') {
      if (this.tools.hammer <= 0) return false;

      if (targetId === 'arm') {
        if (this.activeTool === 'hammer') {
          if (this.fruits.length === 0) {
            this.activeTool = null;
            return false;
          }
          targetId = undefined;
        } else {
          this.activeTool = 'hammer';
          this._pushEvent({ type: 'tool_hammer_armed' });
          return true;
        }
      }

      if (this.fruits.length === 0) {
        this.activeTool = 'hammer';
        return false;
      }

      let targetIdx = -1;
      if (targetId !== undefined && targetId !== null && targetId !== 'auto') {
        const numericId = Number(targetId);
        targetIdx = this.fruits.findIndex((f) => f.id === numericId);
      }
      if (targetIdx < 0) {
        let bestY = -Infinity;
        for (let i = 0; i < this.fruits.length; i++) {
          if (this.fruits[i].y > bestY) {
            bestY = this.fruits[i].y;
            targetIdx = i;
          }
        }
      }
      if (targetIdx < 0) return false;

      const [removed] = this.fruits.splice(targetIdx, 1);
      this.tools.hammer -= 1;
      this.activeTool = null;

      const popBonus = FRUIT_TIERS[removed.tier].score;
      this._addScore(popBonus);
      this._pushEvent({
        type: 'tool_hammer_smash',
        fruitId: removed.id,
        tier: removed.tier,
        x: removed.x,
        y: removed.y,
        bonus: popBonus,
        remaining: this.tools.hammer,
      });
      this._updateOverflowMetrics(0);
      return true;
    }

    return false;
  }

  _addScore(pts) {
    const mult = GAME_MODES[this.mode]?.scoreMultiplier || 1.0;
    const gain = Math.max(0, Math.round(pts * mult));
    this.score += gain;
    if (this.score > this.bestScore) {
      this.bestScore = this.score;
    }
    return gain;
  }

  _pushEvent(ev) {
    this.events.push({ ...ev, frame: this.frame });
    if (this.events.length > 64) {
      this.events.splice(0, this.events.length - 64);
    }
  }

  /**
   * Advances the simulation by `n` fixed frames (`FIXED_DT = 1/60` each).
   * @param {number=} count
   * @return {Object}
   */
  stepFrames(count = 1) {
    const steps = clamp(Math.floor(Number(count) || 1), 0, 7200);
    for (let i = 0; i < steps; i++) {
      this._stepSingleFrame(FIXED_DT);
    }
    return this.getState();
  }

  _stepSingleFrame(dt) {
    if (this.status !== 'playing') {
      return;
    }

    this.frame += 1;
    this.elapsedSec = this.frame * dt;

    if (this.dropCooldown > 0) {
      this.dropCooldown = Math.max(0, this.dropCooldown - dt);
    }
    if (this.shakeTimer > 0) {
      this.shakeTimer = Math.max(0, this.shakeTimer - dt);
    }
    if (this.comboTimer > 0) {
      this.comboTimer = Math.max(0, this.comboTimer - dt);
      if (this.comboTimer <= 0) {
        this.comboCount = 0;
      }
    }

    // Decrement per-fruit post-merge cooldown once per frame before physics substeps
    for (const f of this.fruits) {
      if (f.mergeCooldown > 0) {
        f.mergeCooldown = Math.max(0, f.mergeCooldown - dt);
      }
    }

    // 1. Substepped 240Hz Rigid-Body Integration + Same-Tier Merge + Wall/Floor Clamping
    const subDt = dt / PHYSICS_SUBSTEPS;
    for (let s = 0; s < PHYSICS_SUBSTEPS; s++) {
      this._stepPhysicsSubstep(subDt);
    }

    // 2. Update spawn scale / squash-wobble animations & grace timers
    for (const f of this.fruits) {
      if (f.spawnScale < 1.0) {
        f.spawnScale = Math.min(1.0, f.spawnScale + dt * 4.2);
      }
      if (f.wobbleTimer > 0) {
        f.wobbleTimer = Math.max(0, f.wobbleTimer - dt);
      }
      if (f.graceTimer > 0) {
        f.graceTimer = Math.max(0, f.graceTimer - dt);
      }
    }

    // 3. Evaluate Overflow Warning Rim (2.5s rule after grace expires)
    this._updateOverflowMetrics(dt);
    if (this.maxOverflowTimer >= JAR_CONFIG.overflowLimitSec) {
      this._finishMatch('overflow');
      return;
    }

    // 4. Evaluate 2-Minute Watermelon Rush countdown timer
    if (this.mode === 'rush' && typeof this.timeRemaining === 'number') {
      this.timeRemaining = Math.max(0, this.timeRemaining - dt);
      if (this.timeRemaining <= 0) {
        this._finishMatch('timeout');
        return;
      }
    }
  }

  _stepPhysicsSubstep(subDt) {
    const halfW = JAR_CONFIG.halfWidth;
    const floorY = JAR_CONFIG.floorY;
    const maxSpeed = JAR_CONFIG.maxSpeed;

    // A. Integrate gravity, velocity damping, and position
    for (let i = 0; i < this.fruits.length; i++) {
      const f = this.fruits[i];
      f.vy += JAR_CONFIG.gravity * subDt;

      f.vx *= 1 - 0.12 * subDt;
      f.vy *= 1 - 0.08 * subDt;
      f.omega *= 1 - 0.25 * subDt;

      f.vx = clamp(sanitizeFinite(f.vx, 0), -maxSpeed, maxSpeed);
      f.vy = clamp(sanitizeFinite(f.vy, 0), -maxSpeed, maxSpeed);
      f.omega = clamp(sanitizeFinite(f.omega, 0), -18, 18);

      f.x = sanitizeFinite(f.x + f.vx * subDt, 0);
      f.y = sanitizeFinite(f.y + f.vy * subDt, f.radius);
      f.angle = sanitizeFinite(f.angle + f.omega * subDt, 0);

      this._constrainToJarWallsAndFloor(f, halfW, floorY, subDt);
    }

    // B. Pairwise Collision & Same-Tier Contact Merge Pass
    const mergedIds = new Set();
    const pendingSpawns = [];
    const n = this.fruits.length;

    for (let i = 0; i < n; i++) {
      const A = this.fruits[i];
      if (mergedIds.has(A.id)) continue;

      for (let j = i + 1; j < n; j++) {
        const B = this.fruits[j];
        if (mergedIds.has(B.id)) continue;

        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const distSq = dx * dx + dy * dy;
        const minDist = A.radius + B.radius;
        const mergeTouchMargin = 0.018;

        if (distSq <= (minDist + mergeTouchMargin) * (minDist + mergeTouchMargin)) {
          const canMerge =
            A.tier === B.tier &&
            (A.mergeCooldown || 0) <= 0 &&
            (B.mergeCooldown || 0) <= 0;
          if (canMerge) {
            mergedIds.add(A.id);
            mergedIds.add(B.id);
            pendingSpawns.push({ A, B });
            break;
          }

          if (distSq < minDist * minDist) {
            if (
              A.tier === B.tier &&
              ((A.mergeCooldown || 0) > 0 || (B.mergeCooldown || 0) > 0)
            ) {
              const d = Math.sqrt(distSq);
              const targetD = minDist * 0.95;
              if (d < targetD && d > 1e-6) {
                const nx = dx / d;
                const ny = dy / d;
                const push = (targetD - d) * 0.5;
                A.x -= nx * push * 0.5;
                A.y -= ny * push * 0.5;
                B.x += nx * push * 0.5;
                B.y += ny * push * 0.5;
              }
              A.vx *= 0.85;
              B.vx *= 0.85;
            } else {
              this._resolveElasticPairCollision(A, B, dx, dy, Math.sqrt(distSq), minDist);
            }
          }
        }
      }
    }

    // C. Multi-iteration positional relaxation pass for rigid, low-overlap stacks
    for (let iter = 0; iter < RELAXATION_ITERS; iter++) {
      for (let i = 0; i < this.fruits.length; i++) {
        const A = this.fruits[i];
        if (mergedIds.has(A.id)) continue;
        for (let j = i + 1; j < this.fruits.length; j++) {
          const B = this.fruits[j];
          if (mergedIds.has(B.id)) continue;
          const dx = B.x - A.x;
          const dy = B.y - A.y;
          const d2 = dx * dx + dy * dy;
          const isSameTierCooldown =
            A.tier === B.tier &&
            ((A.mergeCooldown || 0) > 0 || (B.mergeCooldown || 0) > 0);
          const minD = isSameTierCooldown
            ? (A.radius + B.radius) * 0.95
            : A.radius + B.radius;
          if (d2 < minD * minD) {
            const d = Math.sqrt(d2);
            let nx = 0;
            let ny = 1;
            if (d > 1e-6) {
              nx = dx / d;
              ny = dy / d;
            } else {
              const sign = (A.id + B.id) % 2 === 0 ? 1 : -1;
              nx = sign * 0.25;
              ny = 0.968;
            }
            const overlap = minD - d;
            const totalMass = A.mass + B.mass;
            const ratioA = B.mass / totalMass;
            const ratioB = A.mass / totalMass;
            A.x -= nx * overlap * ratioA * 0.95;
            A.y -= ny * overlap * ratioA * 0.95;
            B.x += nx * overlap * ratioB * 0.95;
            B.y += ny * overlap * ratioB * 0.95;
          }
        }
        this._clampPositionToJar(A, halfW, floorY);
      }
    }

    // D. Execute queued merges
    if (pendingSpawns.length > 0) {
      this.fruits = this.fruits.filter((f) => !mergedIds.has(f.id));
      for (const { A, B } of pendingSpawns) {
        this._executePairMerge(A, B, halfW, floorY);
      }
    }

    // E. Final hard boundary clamp & NaN sanitization on all remaining fruits
    for (let i = 0; i < this.fruits.length; i++) {
      this._clampPositionToJar(this.fruits[i], halfW, floorY);
    }
  }

  _clampPositionToJar(f, halfW, floorY) {
    const r = f.radius;
    const minX = -halfW + r;
    const maxX = halfW - r;
    const minY = floorY + r;

    if (!Number.isFinite(f.x)) f.x = 0;
    if (!Number.isFinite(f.y)) f.y = minY;
    if (!Number.isFinite(f.vx)) f.vx = 0;
    if (!Number.isFinite(f.vy)) f.vy = 0;
    if (!Number.isFinite(f.angle)) f.angle = 0;
    if (!Number.isFinite(f.omega)) f.omega = 0;

    if (f.x < minX) f.x = minX;
    else if (f.x > maxX) f.x = maxX;
    if (f.y < minY) f.y = minY;
  }

  _constrainToJarWallsAndFloor(f, halfW, floorY, subDt) {
    const r = f.radius;
    const minX = -halfW + r;
    const maxX = halfW - r;
    const minY = floorY + r;

    if (!Number.isFinite(f.x)) f.x = 0;
    if (!Number.isFinite(f.y)) f.y = minY;
    if (!Number.isFinite(f.vx)) f.vx = 0;
    if (!Number.isFinite(f.vy)) f.vy = 0;
    if (!Number.isFinite(f.angle)) f.angle = 0;
    if (!Number.isFinite(f.omega)) f.omega = 0;

    if (f.x < minX) {
      f.x = minX;
      if (f.vx < 0) {
        f.vx = -f.vx * JAR_CONFIG.wallRestitution;
        f.omega += f.vy * 0.08;
      }
    } else if (f.x > maxX) {
      f.x = maxX;
      if (f.vx > 0) {
        f.vx = -f.vx * JAR_CONFIG.wallRestitution;
        f.omega -= f.vy * 0.08;
      }
    }

    if (f.y <= minY) {
      f.y = minY;
      f.hasSettled = true;
      if (f.vy < 0) {
        if (f.vy < -3.5) {
          this._pushEvent({
            type: 'bounce',
            fruitId: f.id,
            tier: f.tier,
            x: f.x,
            y: f.y,
            speed: Math.abs(f.vy),
          });
        }
        f.vy = -f.vy * JAR_CONFIG.floorRestitution;
        if (Math.abs(f.vy) < 0.45) {
          f.vy = 0;
        }
      }
      f.vx *= Math.max(0.85, 1 - 1.15 * subDt);
      if (Math.abs(f.vx) < 0.015) {
        f.vx = 0;
      }
      f.omega = clamp(-f.vx / Math.max(0.25, r), -14, 14);
    }
  }

  _resolveElasticPairCollision(A, B, dx, dy, dist, minDist) {
    let nx = 0;
    let ny = 1;
    if (dist > 1e-6) {
      nx = dx / dist;
      ny = dy / dist;
    } else {
      const sign = (A.id + B.id) % 2 === 0 ? 1 : -1;
      nx = sign * 0.22;
      ny = 0.9755;
    }

    if (Math.abs(nx) < 0.015 && Math.abs(A.vx) < 0.2 && Math.abs(B.vx) < 0.2) {
      const slipDir = (A.id + B.id) % 2 === 0 ? 1 : -1;
      nx += slipDir * 0.018;
      const len = Math.hypot(nx, ny);
      nx /= len;
      ny /= len;
    }

    const overlap = minDist - dist;
    const invMassA = 1 / A.mass;
    const invMassB = 1 / B.mass;
    const invMassSum = invMassA + invMassB;

    const corrX = nx * overlap * 0.92;
    const corrY = ny * overlap * 0.92;
    A.x -= corrX * (invMassA / invMassSum);
    A.y -= corrY * (invMassA / invMassSum);
    B.x += corrX * (invMassB / invMassSum);
    B.y += corrY * (invMassB / invMassSum);

    A.hasSettled = true;
    B.hasSettled = true;

    const rvx = B.vx - A.vx;
    const rvy = B.vy - A.vy;
    const velAlongNormal = rvx * nx + rvy * ny;
    if (velAlongNormal > 0) {
      return;
    }

    const e = JAR_CONFIG.fruitRestitution;
    const j = (-(1 + e) * velAlongNormal) / invMassSum;
    const impulseX = j * nx;
    const impulseY = j * ny;

    A.vx -= impulseX * invMassA;
    A.vy -= impulseY * invMassA;
    B.vx += impulseX * invMassB;
    B.vy += impulseY * invMassB;

    const tx = -ny;
    const ty = nx;
    const velAlongTangent = rvx * tx + rvy * ty;
    const jt = clamp(
        -velAlongTangent / invMassSum,
        -j * JAR_CONFIG.friction,
        j * JAR_CONFIG.friction
    );
    A.vx -= jt * tx * invMassA;
    A.vy -= jt * ty * invMassA;
    B.vx += jt * tx * invMassB;
    B.vy += jt * ty * invMassB;

    A.omega = clamp(A.omega - (jt * invMassA) / A.radius, -16, 16);
    B.omega = clamp(B.omega + (jt * invMassB) / B.radius, -16, 16);
  }

  _executePairMerge(A, B, halfW, floorY) {
    const midX = (A.x + B.x) * 0.5;
    const midY = (A.y + B.y) * 0.5;

    this.mergeCount += 1;
    if (this.comboTimer > 0) {
      this.comboCount += 1;
    } else {
      this.comboCount = 1;
    }
    this.comboTimer = 2.2;
    if (this.comboCount > this.maxCombo) {
      this.maxCombo = this.comboCount;
    }

    if (this.comboCount >= 3 && this.comboCount % 3 === 0) {
      const order = ['shake', 'hammer', 'rainbow'];
      const toolKey = order[(this.mergeCount - 1) % order.length];
      const maxCap = TOOL_SPECS[toolKey].maxCharges;
      if (this.tools[toolKey] < maxCap) {
        this.tools[toolKey] += 1;
        this._pushEvent({
          type: 'tool_refill',
          tool: toolKey,
          charges: this.tools[toolKey],
          combo: this.comboCount,
        });
      }
    }

    if (A.tier >= FRUIT_TIERS.length - 1) {
      this.goldenMelonBonuses += 1;
      const fountainPts = this._addScore(JAR_CONFIG.goldenFountainBonus);
      this._applyRadialShockwave(midX, midY, 4.8, 7.5);
      this._pushEvent({
        type: 'golden_watermelon_fountain',
        x: midX,
        y: midY,
        bonus: fountainPts,
        combo: this.comboCount,
      });
      return;
    }

    const nextTier = A.tier + 1;
    const spec = FRUIT_TIERS[nextTier];
    const r = spec.radius;
    const clampedX = clamp(midX, -halfW + r, halfW - r);
    const clampedY = Math.max(floorY + r, midY);

    const mergedFruit = {
      id: this.nextEntityId++,
      tier: nextTier,
      nameZh: spec.nameZh,
      nameEn: spec.nameEn,
      x: clampedX,
      y: clampedY,
      z: 0,
      vx: clamp((A.vx + B.vx) * 0.35, -JAR_CONFIG.maxSpeed, JAR_CONFIG.maxSpeed),
      vy: clamp(
          Math.max((A.vy + B.vy) * 0.35, 1.8),
          -JAR_CONFIG.maxSpeed,
          JAR_CONFIG.maxSpeed
      ),
      radius: r,
      mass: spec.mass,
      angle: (A.angle + B.angle) * 0.5,
      omega: clamp((A.omega + B.omega) * 0.4, -10, 10),
      graceTimer: Math.max(1.1, A.graceTimer, B.graceTimer),
      overflowTimer: 0,
      mergeCooldown: MERGE_COOLDOWN_SEC,
      hasSettled: true,
      spawnScale: 0.58,
      wobbleTimer: 0.45,
      mergedFrom: true,
    };

    this.fruits.push(mergedFruit);
    if (nextTier > this.highestTier) {
      this.highestTier = nextTier;
    }

    const comboFactor = Math.min(3.0, 1 + (this.comboCount - 1) * 0.25);
    let basePts = Math.round(spec.score * comboFactor);
    if (nextTier === FRUIT_TIERS.length - 1) {
      this.watermelonsCreated += 1;
      basePts += JAR_CONFIG.bigWatermelonSynthesisBonus;
    }
    const gainedPts = this._addScore(basePts);

    this._applyRadialShockwave(
        clampedX,
        clampedY,
        r * 2.5,
        3.2 + nextTier * 0.35,
        mergedFruit.id,
        nextTier
    );

    this._pushEvent({
      type: 'merge',
      fromTier: A.tier,
      toTier: nextTier,
      fruitId: mergedFruit.id,
      x: clampedX,
      y: clampedY,
      scoreGained: gainedPts,
      combo: this.comboCount,
      isBigWatermelon: nextTier === FRUIT_TIERS.length - 1,
    });
  }

  _applyRadialShockwave(cx, cy, radius, strength, excludeId = -1, excludeCooldownTier = -1) {
    for (const f of this.fruits) {
      if (f.id === excludeId) continue;
      if (excludeCooldownTier >= 0 && f.tier === excludeCooldownTier && (f.mergeCooldown || 0) > 0) {
        continue;
      }
      const dx = f.x - cx;
      const dy = f.y - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > 1e-4 && dist < radius + f.radius) {
        const falloff = 1 - dist / (radius + f.radius);
        const nx = dx / dist;
        const ny = dy / dist;
        const push = strength * falloff;
        f.vx = clamp(f.vx + nx * push, -JAR_CONFIG.maxSpeed, JAR_CONFIG.maxSpeed);
        f.vy = clamp(
            f.vy + Math.max(0.2, ny) * push,
            -JAR_CONFIG.maxSpeed,
            JAR_CONFIG.maxSpeed
        );
      }
    }
  }

  _updateOverflowMetrics(dt) {
    let maxTimer = 0;
    for (const f of this.fruits) {
      const aboveRim = f.y + f.radius * 0.25 > JAR_CONFIG.rimY;
      if (f.graceTimer <= 0 && aboveRim) {
        if (dt > 0) {
          f.overflowTimer = sanitizeFinite(f.overflowTimer + dt, 0);
        }
      } else if (dt > 0 && f.overflowTimer > 0) {
        f.overflowTimer = Math.max(0, f.overflowTimer - dt * 2.0);
      }
      if (f.overflowTimer > maxTimer) {
        maxTimer = f.overflowTimer;
      }
    }
    this.maxOverflowTimer = maxTimer;
  }

  _finishMatch(reason) {
    this.status = 'podium';
    this.endReason = reason;
    this.activeTool = null;

    const thresholds = GAME_MODES[this.mode]?.starThresholds || [3000, 8000, 15000];
    if (this.watermelonsCreated >= 1 || this.score >= thresholds[2]) {
      this.stars = 3;
      this.podiumRank = 1;
    } else if (this.score >= thresholds[1]) {
      this.stars = 2;
      this.podiumRank = 2;
    } else if (this.score >= thresholds[0]) {
      this.stars = 1;
      this.podiumRank = 3;
    } else {
      this.stars = 0;
      this.podiumRank = 4;
    }

    this._pushEvent({
      type: 'match_end',
      reason,
      score: this.score,
      stars: this.stars,
      podiumRank: this.podiumRank,
    });
  }

  getProjectedDropY() {
    const r = this.currentFruit ? this.currentFruit.radius : FRUIT_TIERS[0].radius;
    let landingY = JAR_CONFIG.floorY + r;
    for (const f of this.fruits) {
      const dx = Math.abs(this.aimX - f.x);
      const sumR = r + f.radius;
      if (dx < sumR) {
        const dy = Math.sqrt(Math.max(0, sumR * sumR - dx * dx));
        const candidateY = f.y + dy;
        if (candidateY > landingY && candidateY <= JAR_CONFIG.spawnY) {
          landingY = candidateY;
        }
      }
    }
    return clamp(landingY, JAR_CONFIG.floorY + r, JAR_CONFIG.spawnY - 0.2);
  }

  getState() {
    return {
      status: this.status,
      mode: this.mode,
      seed: this.seed,
      frame: this.frame,
      elapsedSec: Number(this.elapsedSec.toFixed(4)),
      timeRemaining:
        typeof this.timeRemaining === 'number'
          ? Number(this.timeRemaining.toFixed(3))
          : null,
      score: this.score,
      bestScore: this.bestScore,
      stars: this.stars,
      podiumRank: this.podiumRank,
      endReason: this.endReason,
      aimX: Number(this.aimX.toFixed(4)),
      projectedDropY: Number(this.getProjectedDropY().toFixed(4)),
      dropCooldown: Number(this.dropCooldown.toFixed(4)),
      dropCount: this.dropCount,
      currentFruit: this.currentFruit ? { ...this.currentFruit } : null,
      nextFruitTier: this.nextFruitTier,
      nextFruit: FRUIT_TIERS[this.nextFruitTier]
        ? {
            tier: this.nextFruitTier,
            id: FRUIT_TIERS[this.nextFruitTier].id,
            nameZh: FRUIT_TIERS[this.nextFruitTier].nameZh,
            nameEn: FRUIT_TIERS[this.nextFruitTier].nameEn,
            radius: FRUIT_TIERS[this.nextFruitTier].radius,
          }
        : null,
      highestTier: this.highestTier,
      mergeCount: this.mergeCount,
      comboCount: this.comboCount,
      maxCombo: this.maxCombo,
      comboTimer: Number(this.comboTimer.toFixed(3)),
      watermelonsCreated: this.watermelonsCreated,
      goldenMelonBonuses: this.goldenMelonBonuses,
      maxOverflowTimer: Number(this.maxOverflowTimer.toFixed(3)),
      overflowLimitSec: JAR_CONFIG.overflowLimitSec,
      jar: {
        width: JAR_CONFIG.width,
        halfWidth: JAR_CONFIG.halfWidth,
        floorY: JAR_CONFIG.floorY,
        rimY: JAR_CONFIG.rimY,
        spawnY: JAR_CONFIG.spawnY,
      },
      tools: { ...this.tools },
      activeTool: this.activeTool,
      shakeTimer: Number(this.shakeTimer.toFixed(3)),
      fruits: this.fruits.map((f) => ({
        id: f.id,
        tier: f.tier,
        nameZh: f.nameZh,
        nameEn: f.nameEn,
        x: Number(f.x.toFixed(5)),
        y: Number(f.y.toFixed(5)),
        z: Number(f.z.toFixed(5)),
        vx: Number(f.vx.toFixed(5)),
        vy: Number(f.vy.toFixed(5)),
        radius: f.radius,
        mass: f.mass,
        angle: Number(f.angle.toFixed(5)),
        omega: Number(f.omega.toFixed(5)),
        graceTimer: Number(f.graceTimer.toFixed(4)),
        overflowTimer: Number(f.overflowTimer.toFixed(4)),
        mergeCooldown: Number((f.mergeCooldown || 0).toFixed(4)),
        hasSettled: Boolean(f.hasSettled),
        spawnScale: Number(f.spawnScale.toFixed(4)),
        wobbleTimer: Number(f.wobbleTimer.toFixed(4)),
      })),
      recentEvents: this.events.slice(-16).map((e) => ({ ...e })),
    };
  }
}
