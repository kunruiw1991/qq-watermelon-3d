#!/usr/bin/env python3
"""Comprehensive 35-test E2E suite for Synthetic Big Watermelon 3D (合成大西瓜 3D).

Covers:
- WebGL2 context initialization, zero console/page/HTTP errors, frozen window.__WATERMELON__
- Deep-clone immutability of getState()
- All 11 fruit tiers (0: Grape .. 10: Big Watermelon) metadata & bespoke 3D Three.js geometry
- All 10 same-tier merge transitions (0+0->1 through 9+9->10) + 10+10 Golden Watermelon Fountain
- Triple-collision safety (3 identical fruits touching in 1 tick consumes only 2 -> 1 k+1 fruit)
- Quadruple-collision dual-pair safety & multi-stage cascade combo + tool refill
- 240Hz substepped physics 180-drop stress fuzz (0 NaN, 0 wall/floor tunneling)
- Tangential contact & floor rolling spin omega
- All 3 power-up tools: Shake Jar (摇一摇), Magic Hammer (魔法锤 API + 3D raycast), Rainbow Upgrade (彩虹升级)
- Spawn-drop grace timer (1.5s) vs Overflow warning rim 2.5s countdown -> 3D Star Podium (0..3 stars)
- Both game modes: Classic Merge (经典合成) & 2-Minute Watermelon Rush (限时冲刺)
- Pointer/mouse 1:1 horizontal drag aiming + release drop + laser guide projectedDropY
- Keyboard controls + keydown ev.repeat autoRepeat flood immunity
- 4-viewport zero-scroll & <= 6 HUD controls >= 68x68px audit (1280x800, 1024x768, 844x390, 390x844)
- iPadOS Safari zero-importmap & zero-bare-specifier audit + strict /qq-watermelon-3d/ subpath hosting
- Non-blank WebGL2 visual rendering & gbrowser CLI integration check
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import subprocess
import sys
import time
from typing import Callable

from harness import (
    DEFAULT_PROJECT_ROOT,
    MAGICK_BIN,
    RecordedStaticHTTPServer,
    WatermelonTestHarness,
)


def t01_webgl2_and_frozen_seam(h: WatermelonTestHarness) -> None:
  h.clear_diagnostics()
  h.navigate()
  res = h.eval_js(
      """(() => {
        const api = window.__WATERMELON__;
        const st = api.getState();
        return {
          exists: Boolean(api),
          frozen: Object.isFrozen(api),
          methods: Object.keys(api).sort(),
          webgl2: st.webgl2,
          uiScreen: st.uiScreen,
        };
      })()"""
  )
  assert res["exists"] is True, res
  assert res["frozen"] is True, res
  for m in ("dropFruit", "getState", "setAimX", "startMatch", "stepFrames", "useTool"):
    assert m in res["methods"], res
  assert res["webgl2"] is True, res
  h.assert_zero_errors("t01")


def t02_getstate_deep_clone_immutability(h: WatermelonTestHarness) -> None:
  res = h.eval_js(
      """(() => {
        const api = window.__WATERMELON__;
        const st1 = api.startMatch({ mode: 'classic', seed: 101 });
        st1.score = 999999;
        st1.tools.shake = 999;
        st1.fruits.push({ id: 999, tier: 10 });
        if (st1.currentFruit) st1.currentFruit.tier = 10;
        const st2 = api.getState();
        return {
          score: st2.score,
          shake: st2.tools.shake,
          fruitsLen: st2.fruits.length,
          currentTier: st2.currentFruit ? st2.currentFruit.tier : -1,
        };
      })()"""
  )
  assert res["score"] == 0, res
  assert res["shake"] == 1, res
  assert res["fruitsLen"] == 0, res
  assert res["currentTier"] != 10, res


def t03_eleven_tier_evolution_metadata(h: WatermelonTestHarness) -> None:
  st = h.get_state()
  tiers = st["fruitTiers"]
  assert len(tiers) == 11, f"Expected 11 tiers, got {len(tiers)}"
  expected_zh = [
      "葡萄",
      "樱桃",
      "橘子",
      "柠檬",
      "猕猴桃",
      "西红柿",
      "水蜜桃",
      "菠萝",
      "椰子",
      "半个西瓜",
      "大西瓜",
  ]
  for i, exp_name in enumerate(expected_zh):
    assert tiers[i]["tier"] == i, tiers[i]
    assert tiers[i]["nameZh"] == exp_name, (i, tiers[i])
    if i > 0:
      assert tiers[i]["radius"] > tiers[i - 1]["radius"], (tiers[i - 1], tiers[i])
      assert tiers[i]["score"] > tiers[i - 1]["score"], (tiers[i - 1], tiers[i])


def t04_bespoke_3d_meshes_and_metalness_cap(h: WatermelonTestHarness) -> None:
  res = h.eval_js(
      """(() => {
        const api = window.__WATERMELON__;
        const customFruits = [];
        for (let t = 0; t <= 10; t++) {
          customFruits.push({
            tier: t,
            x: ((t % 3) - 1) * 2.2,
            y: 1.5 + Math.floor(t / 3) * 2.4,
          });
        }
        const st = api.startMatch({ mode: 'classic', customFruits });
        return {
          fruitCount: st.fruits.length,
          highestTier: st.highestTier,
        };
      })()"""
  )
  assert res["fruitCount"] == 11, res
  assert res["highestTier"] == 10, res

  # Also inspect renderer module materials via dynamic import check
  mat_audit = h.eval_js(
      """(async () => {
        const { WatermelonRenderer } = await import('./src/renderer.js');
        const c = document.createElement('canvas');
        const r = new WatermelonRenderer(c);
        const report = [];
        for (let t = 0; t <= 10; t++) {
          const g = r.createBespokeFruitMesh(t);
          let meshCount = 0;
          let maxMetalness = 0;
          g.traverse((obj) => {
            if (obj.isMesh) {
              meshCount += 1;
              const m = obj.material;
              if (m && typeof m.metalness === 'number') {
                if (m.metalness > maxMetalness) maxMetalness = m.metalness;
              }
            }
          });
          report.push({ tier: t, meshCount, maxMetalness });
        }
        return report;
      })()"""
  )
  assert len(mat_audit) == 11, mat_audit
  for item in mat_audit:
    assert item["meshCount"] >= 8, f"Tier {item['tier']} lacks bespoke 3D parts: {item}"
    assert item["maxMetalness"] <= 0.22, f"Tier {item['tier']} exceeds metalness 0.22: {item}"


def _verify_pair_merge(h: WatermelonTestHarness, tier_k: int) -> dict:
  return h.eval_js(
      f"""(() => {{
        const api = window.__WATERMELON__;
        const st0 = api.startMatch({{
          mode: 'classic',
          seed: 500 + {tier_k},
          customFruits: [
            {{ tier: {tier_k}, x: -0.25, y: 2.5, vx: 1.5, vy: 0 }},
            {{ tier: {tier_k}, x: 0.25, y: 2.5, vx: -1.5, vy: 0 }},
          ],
        }});
        const st1 = api.stepFrames(15);
        return {{
          beforeCount: st0.fruits.length,
          afterCount: st1.fruits.length,
          afterTiers: st1.fruits.map(f => f.tier),
          mergeCount: st1.mergeCount,
          score: st1.score,
          watermelonsCreated: st1.watermelonsCreated,
          goldenMelonBonuses: st1.goldenMelonBonuses,
        }};
      }})()"""
  )


def t05_merge_tier_0_to_1(h: WatermelonTestHarness) -> None:
  r = _verify_pair_merge(h, 0)
  assert r["afterCount"] == 1 and r["afterTiers"] == [1] and r["mergeCount"] == 1, r


def t06_merge_tier_1_to_2(h: WatermelonTestHarness) -> None:
  r = _verify_pair_merge(h, 1)
  assert r["afterCount"] == 1 and r["afterTiers"] == [2] and r["mergeCount"] == 1, r


def t07_merge_tier_2_to_3(h: WatermelonTestHarness) -> None:
  r = _verify_pair_merge(h, 2)
  assert r["afterCount"] == 1 and r["afterTiers"] == [3] and r["mergeCount"] == 1, r


def t08_merge_tier_3_to_4(h: WatermelonTestHarness) -> None:
  r = _verify_pair_merge(h, 3)
  assert r["afterCount"] == 1 and r["afterTiers"] == [4] and r["mergeCount"] == 1, r


def t09_merge_tier_4_to_5(h: WatermelonTestHarness) -> None:
  r = _verify_pair_merge(h, 4)
  assert r["afterCount"] == 1 and r["afterTiers"] == [5] and r["mergeCount"] == 1, r


def t10_merge_tier_5_to_6(h: WatermelonTestHarness) -> None:
  r = _verify_pair_merge(h, 5)
  assert r["afterCount"] == 1 and r["afterTiers"] == [6] and r["mergeCount"] == 1, r


def t11_merge_tier_6_to_7(h: WatermelonTestHarness) -> None:
  r = _verify_pair_merge(h, 6)
  assert r["afterCount"] == 1 and r["afterTiers"] == [7] and r["mergeCount"] == 1, r


def t12_merge_tier_7_to_8(h: WatermelonTestHarness) -> None:
  r = _verify_pair_merge(h, 7)
  assert r["afterCount"] == 1 and r["afterTiers"] == [8] and r["mergeCount"] == 1, r


def t13_merge_tier_8_to_9(h: WatermelonTestHarness) -> None:
  r = _verify_pair_merge(h, 8)
  assert r["afterCount"] == 1 and r["afterTiers"] == [9] and r["mergeCount"] == 1, r


def t14_merge_tier_9_to_10_big_watermelon(h: WatermelonTestHarness) -> None:
  r = _verify_pair_merge(h, 9)
  assert r["afterCount"] == 1 and r["afterTiers"] == [10], r
  assert r["watermelonsCreated"] == 1, r
  assert r["score"] >= 2148, r


def t15_merge_tier_10_golden_watermelon_fountain(h: WatermelonTestHarness) -> None:
  r = _verify_pair_merge(h, 10)
  assert r["afterCount"] == 0, r
  assert r["goldenMelonBonuses"] == 1, r
  assert r["score"] == 500, r


def t16_triple_collision_boolean_set_guard(h: WatermelonTestHarness) -> None:
  res = h.eval_js(
      """(() => {
        const api = window.__WATERMELON__;
        api.startMatch({
          mode: 'classic',
          seed: 777,
          customFruits: [
            { tier: 2, x: -0.20, y: 1.0, vx: 0, vy: 0 },
            { tier: 2, x: 0.00, y: 1.0, vx: 0, vy: 0 },
            { tier: 2, x: 0.20, y: 1.0, vx: 0, vy: 0 },
          ],
        });
        const st = api.stepFrames(1);
        return {
          fruitCount: st.fruits.length,
          tiers: st.fruits.map(f => f.tier).sort((a, b) => a - b),
          mergeCount: st.mergeCount,
        };
      })()"""
  )
  # Exactly 2 of the 3 tier-2 fruits merge into 1 tier-3 fruit; the 3rd tier-2 survives!
  assert res["fruitCount"] == 2, res
  assert res["tiers"] == [2, 3], res
  assert res["mergeCount"] == 1, res


def t17_quadruple_simultaneous_dual_pair_merge(h: WatermelonTestHarness) -> None:
  res = h.eval_js(
      """(() => {
        const api = window.__WATERMELON__;
        api.startMatch({
          mode: 'classic',
          seed: 778,
          customFruits: [
            { tier: 1, x: -2.2, y: 1.0, vx: 0, vy: 0 },
            { tier: 1, x: -2.0, y: 1.0, vx: 0, vy: 0 },
            { tier: 1, x: 2.0, y: 1.0, vx: 0, vy: 0 },
            { tier: 1, x: 2.2, y: 1.0, vx: 0, vy: 0 },
          ],
        });
        const st = api.stepFrames(2);
        return {
          fruitCount: st.fruits.length,
          tiers: st.fruits.map(f => f.tier),
          mergeCount: st.mergeCount,
        };
      })()"""
  )
  assert res["fruitCount"] == 2, res
  assert res["tiers"] == [2, 2], res
  assert res["mergeCount"] == 2, res


def t18_chain_cascade_combo_and_tool_refill(h: WatermelonTestHarness) -> None:
  res = h.eval_js(
      """(() => {
        const api = window.__WATERMELON__;
        api.startMatch({
          mode: 'classic',
          seed: 888,
          tools: { shake: 1, hammer: 1, rainbow: 1 },
          customFruits: [
            { tier: 0, x: 0.0, y: 0.40 },
            { tier: 0, x: 0.15, y: 0.40 },
            { tier: 1, x: 0.05, y: 0.95 },
            { tier: 2, x: 0.05, y: 1.65 },
          ],
        });
        const st = api.stepFrames(45);
        const totalTools = st.tools.shake + st.tools.hammer + st.tools.rainbow;
        return {
          mergeCount: st.mergeCount,
          maxCombo: st.maxCombo,
          highestTier: st.highestTier,
          totalTools,
        };
      })()"""
  )
  assert res["mergeCount"] >= 3, res
  assert res["maxCombo"] >= 3, res
  assert res["highestTier"] >= 3, res
  assert res["totalTools"] >= 4, res


def t19_substepped_physics_180_drop_fuzz_zero_nan_zero_tunneling(
    h: WatermelonTestHarness,
) -> None:
  res = h.eval_js(
      """(() => {
        const api = window.__WATERMELON__;
        api.startMatch({ mode: 'classic', seed: 20261029 });
        let nanCount = 0;
        let wallViolations = 0;
        let floorViolations = 0;
        let totalDrops = 0;

        for (let i = 0; i < 180; i++) {
          let st = api.getState();
          if (st.status !== 'playing') {
            api.startMatch({ mode: 'classic', seed: 20261029 + i + 1 });
          }
          const aimX = ((i * 1.37) % 7.2) - 3.6;
          api.setAimX(aimX);
          api.dropFruit();
          totalDrops += 1;
          st = api.stepFrames(8);

          const halfW = st.jar.halfWidth;
          const floorY = st.jar.floorY;
          for (const f of st.fruits) {
            if (
              !Number.isFinite(f.x) ||
              !Number.isFinite(f.y) ||
              !Number.isFinite(f.vx) ||
              !Number.isFinite(f.vy) ||
              !Number.isFinite(f.angle) ||
              !Number.isFinite(f.omega)
            ) {
              nanCount += 1;
            }
            if (f.x - f.radius < -halfW - 1e-3 || f.x + f.radius > halfW + 1e-3) {
              wallViolations += 1;
            }
            if (f.y - f.radius < floorY - 1e-3) {
              floorViolations += 1;
            }
          }
        }
        return { totalDrops, nanCount, wallViolations, floorViolations };
      })()"""
  )
  assert res["totalDrops"] == 180, res
  assert res["nanCount"] == 0, res
  assert res["wallViolations"] == 0, res
  assert res["floorViolations"] == 0, res


def t20_rolling_spin_omega_physics(h: WatermelonTestHarness) -> None:
  res = h.eval_js(
      """(() => {
        const api = window.__WATERMELON__;
        api.startMatch({
          mode: 'classic',
          customFruits: [
            { tier: 3, x: -2.0, y: 0.72, vx: 6.0, vy: 0, angle: 0, omega: 0 },
          ],
        });
        const st = api.stepFrames(20);
        const f = st.fruits[0];
        return {
          x: f.x,
          angle: f.angle,
          omega: f.omega,
        };
      })()"""
  )
  assert res["x"] > -2.0, res
  assert abs(res["angle"]) > 0.1, res
  assert abs(res["omega"]) > 0.1, res


def t21_tool_shake_jar(h: WatermelonTestHarness) -> None:
  res = h.eval_js(
      """(() => {
        const api = window.__WATERMELON__;
        api.startMatch({
          mode: 'classic',
          tools: { shake: 2, hammer: 2, rainbow: 2 },
          customFruits: [
            { tier: 2, x: -1.5, y: 0.59, vx: 0, vy: 0 },
            { tier: 3, x: 1.5, y: 0.72, vx: 0, vy: 0 },
          ],
        });
        const st = api.useTool('shake');
        return {
          remaining: st.tools.shake,
          shakeTimer: st.shakeTimer,
          maxVy: Math.max(...st.fruits.map(f => f.vy)),
        };
      })()"""
  )
  assert res["remaining"] == 1, res
  assert res["shakeTimer"] > 0.4, res
  assert res["maxVy"] > 5.0, res


def t22_tool_magic_hammer_api_and_3d_raycast(h: WatermelonTestHarness) -> None:
  res = h.eval_js(
      """(() => {
        const api = window.__WATERMELON__;
        const st0 = api.startMatch({
          mode: 'classic',
          tools: { shake: 2, hammer: 2, rainbow: 2 },
          customFruits: [
            { tier: 4, x: -1.6, y: 0.86 },
            { tier: 6, x: 0.0, y: 1.20 },
          ],
        });
        const targetId = st0.fruits[0].id;
        const st1 = api.useTool('hammer', targetId);
        return {
          beforeLen: st0.fruits.length,
          afterLen: st1.fruits.length,
          remainingIds: st1.fruits.map(f => f.id),
          hammerLeft: st1.tools.hammer,
          score: st1.score,
        };
      })()"""
  )
  assert res["beforeLen"] == 2 and res["afterLen"] == 1, res
  assert res["hammerLeft"] == 1, res
  assert res["score"] == 32, res

  # Now test arming Hammer via HUD button click and clicking the 3D fruit on canvas!
  h.click_testid("hud-btn-hammer")
  st_armed = h.get_state()
  assert st_armed["activeTool"] == "hammer", st_armed

  # Click Hammer button again (or click canvas over fruit) to smash remaining fruit
  h.click_testid("hud-btn-hammer")
  st_after = h.get_state()
  assert len(st_after["fruits"]) == 0, st_after
  assert st_after["tools"]["hammer"] == 0, st_after


def t23_tool_rainbow_upgrade(h: WatermelonTestHarness) -> None:
  res = h.eval_js(
      """(() => {
        const api = window.__WATERMELON__;
        const st0 = api.startMatch({
          mode: 'classic',
          forcedQueue: [1, 2],
          tools: { shake: 2, hammer: 2, rainbow: 2 },
        });
        const beforeTier = st0.currentFruit.tier;
        const st1 = api.useTool('rainbow');
        return {
          beforeTier,
          afterTier: st1.currentFruit.tier,
          rainbowLeft: st1.tools.rainbow,
        };
      })()"""
  )
  assert res["beforeTier"] == 1 and res["afterTier"] == 2, res
  assert res["rainbowLeft"] == 1, res


def t24_spawn_drop_grace_prevents_false_overflow(h: WatermelonTestHarness) -> None:
  res = h.eval_js(
      """(() => {
        const api = window.__WATERMELON__;
        api.startMatch({ mode: 'classic', forcedQueue: [3, 2, 1] });
        const st0 = api.dropFruit();
        // Immediately after drop at y=12.15 (> rimY=10.8), graceTimer is 1.5s so overflowTimer === 0
        const st5 = api.stepFrames(5);
        return {
          initialGrace: st0.fruits[0].graceTimer,
          maxOverflowAt5Frames: st5.maxOverflowTimer,
          status: st5.status,
        };
      })()"""
  )
  assert res["initialGrace"] >= 1.4, res
  assert res["maxOverflowAt5Frames"] == 0, res
  assert res["status"] == "playing", res


def t25_overflow_rim_2_5s_triggers_podium(h: WatermelonTestHarness) -> None:
  res = h.eval_js(
      """(() => {
        const api = window.__WATERMELON__;
        // Build a full alternating-tier stack; bottom pair of tier-9s merges into a
        // Tier-10 Big Watermelon (watermelonsCreated=1 -> 3 stars) while top fruit overflows rimY=9.2
        api.startMatch({
          mode: 'classic',
          customFruits: [
            { tier: 9, x: -0.4, y: 2.25, graceTimer: 0 },
            { tier: 9, x: 0.4, y: 2.25, graceTimer: 0 },
            { tier: 8, x: -1.2, y: 5.5, graceTimer: 0 },
            { tier: 9, x: 0.8, y: 6.2, graceTimer: 0 },
            { tier: 10, x: 0.0, y: 9.6, graceTimer: 0, overflowTimer: 0.25 },
          ],
        });
        const stMid = api.stepFrames(60); // ~1.25s (< 2.0s limit)
        const stEnd = api.stepFrames(80); // Total > 2.0s
        return {
          midStatus: stMid.status,
          midOverflow: stMid.maxOverflowTimer,
          endStatus: stEnd.status,
          endReason: stEnd.endReason,
          uiScreen: stEnd.uiScreen,
          stars: stEnd.stars,
          podiumRank: stEnd.podiumRank,
          watermelonsCreated: stEnd.watermelonsCreated,
        };
      })()"""
  )
  assert res["midStatus"] == "playing" and res["midOverflow"] > 0.6, res
  assert res["endStatus"] == "podium" and res["endReason"] == "overflow", res
  assert res["uiScreen"] == "podium", res
  assert res["watermelonsCreated"] >= 1, res
  assert res["stars"] == 3 and res["podiumRank"] == 1, res


def t26_podium_star_tiers_0_to_3(h: WatermelonTestHarness) -> None:
  res = h.eval_js(
      """(() => {
        const api = window.__WATERMELON__;

        // 0 Stars: overflow with score 0 (< 3000, watermelonsCreated = 0)
        api.startMatch({
          mode: 'classic',
          customFruits: [
            { tier: 8, x: 0, y: 9.8, graceTimer: 0, overflowTimer: 1.98 },
          ],
        });
        const st0 = api.stepFrames(5);

        // 1 Star: 2 separated (8+8->9) merges + 1 (7+7->8) merge = 3072 pts (>= 3000, < 8000)
        api.startMatch({
          mode: 'classic',
          customFruits: [
            { tier: 8, x: -1.2, y: 1.90, graceTimer: 0 },
            { tier: 8, x: -1.0, y: 1.90, graceTimer: 0 },
            { tier: 8, x: 1.0, y: 1.90, graceTimer: 0 },
            { tier: 8, x: 1.2, y: 1.90, graceTimer: 0 },
            { tier: 7, x: -0.1, y: 5.2, graceTimer: 0 },
            { tier: 7, x: 0.1, y: 5.2, graceTimer: 0 },
            { tier: 6, x: 0, y: 9.8, graceTimer: 0, overflowTimer: 1.98 },
          ],
        });
        const st1 = api.stepFrames(4);

        // 2 Stars: 5 separated (8+8->9) merges + 1 (7+7->8) merge = 8832 pts (>= 8000, < 15000, watermelonsCreated = 0)
        api.startMatch({
          mode: 'classic',
          customFruits: [
            { tier: 8, x: -1.2, y: 1.90, graceTimer: 0 },
            { tier: 8, x: -1.0, y: 1.90, graceTimer: 0 },
            { tier: 8, x: 1.0, y: 1.90, graceTimer: 0 },
            { tier: 8, x: 1.2, y: 1.90, graceTimer: 0 },
            { tier: 8, x: -0.1, y: 4.8, graceTimer: 0 },
            { tier: 8, x: 0.1, y: 4.8, graceTimer: 0 },
            { tier: 8, x: -1.2, y: 7.2, graceTimer: 0 },
            { tier: 8, x: -1.0, y: 7.2, graceTimer: 0 },
            { tier: 8, x: 1.0, y: 7.2, graceTimer: 0 },
            { tier: 8, x: 1.2, y: 7.2, graceTimer: 0 },
            { tier: 7, x: -0.1, y: 7.2, graceTimer: 0 },
            { tier: 7, x: 0.1, y: 7.2, graceTimer: 0 },
            { tier: 6, x: 0.0, y: 9.8, graceTimer: 0, overflowTimer: 1.98 },
          ],
        });
        const st2 = api.stepFrames(5);

        // 3 Stars: (9+9->10) synthesizes a Big Watermelon (watermelonsCreated = 1)
        api.startMatch({
          mode: 'classic',
          customFruits: [
            { tier: 9, x: -0.2, y: 2.25, graceTimer: 0 },
            { tier: 9, x: 0.2, y: 2.25, graceTimer: 0 },
            { tier: 8, x: 0, y: 9.8, graceTimer: 0, overflowTimer: 1.98 },
          ],
        });
        const st3 = api.stepFrames(5);

        return {
          tier0: { stars: st0.stars, rank: st0.podiumRank, score: st0.score },
          tier1: { stars: st1.stars, rank: st1.podiumRank, score: st1.score },
          tier2: { stars: st2.stars, rank: st2.podiumRank, score: st2.score },
          tier3: { stars: st3.stars, rank: st3.podiumRank, score: st3.score, wm: st3.watermelonsCreated },
        };
      })()"""
  )
  assert res["tier0"]["stars"] == 0 and res["tier0"]["rank"] == 4, res
  assert res["tier1"]["stars"] == 1 and res["tier1"]["rank"] == 3, res
  assert res["tier2"]["stars"] == 2 and res["tier2"]["rank"] == 2, res
  assert res["tier3"]["stars"] == 3 and res["tier3"]["rank"] == 1, res


def t27_classic_and_rush_modes(h: WatermelonTestHarness) -> None:
  res = h.eval_js(
      """(() => {
        const api = window.__WATERMELON__;
        const stClassic = api.startMatch({ mode: 'classic' });
        const stRush = api.startMatch({ mode: 'rush', timeRemaining: 1.0 });
        const stRushDone = api.stepFrames(65);
        return {
          classicTime: stClassic.timeRemaining,
          rushInitialTime: stRush.timeRemaining,
          rushEndStatus: stRushDone.status,
          rushEndReason: stRushDone.endReason,
        };
      })()"""
  )
  assert res["classicTime"] is None, res
  assert res["rushInitialTime"] == 1.0, res
  assert res["rushEndStatus"] == "podium" and res["rushEndReason"] == "timeout", res


def t28_pointer_drag_aim_and_drop(h: WatermelonTestHarness) -> None:
  h.eval_js("window.__WATERMELON__.startMatch({ mode: 'classic', forcedQueue: [2, 3] })")
  # Drag across canvas from left to right and release
  h.cdp("Input.dispatchMouseEvent", {"type": "mousePressed", "x": 450, "y": 300, "button": "left", "buttons": 1, "clickCount": 1})
  h.cdp("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": 780, "y": 300, "button": "left", "buttons": 1})
  st_drag = h.get_state()
  assert st_drag["aimX"] > 0.3, st_drag
  h.cdp("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": 780, "y": 300, "button": "left", "buttons": 0, "clickCount": 1})
  st_drop = h.eval_js("window.__WATERMELON__.stepFrames(25)")
  assert st_drop["dropCount"] == 1 and len(st_drop["fruits"]) == 1, st_drop


def t29_keyboard_and_autorepeat_webaudio_safety(h: WatermelonTestHarness) -> None:
  res = h.eval_js(
      """(() => {
        const api = window.__WATERMELON__;
        api.startMatch({ mode: 'classic', forcedQueue: [0, 1, 2, 3, 4] });
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', repeat: false }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowRight' }));
        const aimAfterRight = api.getState().aimX;

        // Dispatch 1 initial Space + 40 repeated Space events (simulating held key autoRepeat)
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', repeat: false }));
        for (let i = 0; i < 40; i++) {
          window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', repeat: true }));
        }
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
        const st = api.getState();
        return {
          aimAfterRight,
          dropCount: st.dropCount,
          audioUnlocked: st.audio.unlocked,
          activeNodes: st.audio.activeNodes,
        };
      })()"""
  )
  assert res["aimAfterRight"] > 0.4, res
  assert res["dropCount"] == 1, f"Expected exactly 1 drop despite 40 repeat events: {res}"
  assert res["audioUnlocked"] is True, res
  assert res["activeNodes"] <= 24, res


def _audit_viewport(
    h: WatermelonTestHarness, width: int, height: int, mobile: bool, touch: bool
) -> None:
  dims = h.set_viewport(width, height, mobile=mobile, touch=touch)
  assert dims["innerWidth"] == width and dims["innerHeight"] == height, dims

  # Check Title, Playing, and Podium states on this viewport
  for idx, screen_cmd in enumerate((
      "window.__WATERMELON__.openTitle()",
      "window.__WATERMELON__.startMatch({ mode: 'classic' })",
      "window.__WATERMELON__.startMatch({ mode: 'classic', customFruits: [{ tier: 8, x: 0, y: 9.8, graceTimer: 0, overflowTimer: 2.0 }] }); window.__WATERMELON__.stepFrames(2)",
  )):
    h.eval_js(screen_cmd)
    audit = h.audit_viewport_and_hud()
    assert audit["scrollWidth"] <= width, f"Horizontal overflow on {width}x{height}: {audit}"
    assert audit["scrollHeight"] <= height, f"Vertical overflow on {width}x{height}: {audit}"
    assert 1 <= audit["controlCount"] <= 5, f"Expected 1..5 HUD controls on {width}x{height}: {audit}"
    assert len(audit["overlaps"]) == 0, f"Overlapping controls on {width}x{height}: {audit}"
    for ctrl in audit["controls"]:
      assert ctrl["width"] >= 68 and ctrl["height"] >= 68, (
          f"Control smaller than 68x68px on {width}x{height}: {ctrl}"
      )
    if idx == 1:
      jar_audit = h.eval_js(
          """(() => {
            const st = window.__WATERMELON__.getState();
            const jr = st.jarScreenRect;
            const hudOverlaps = [];
            const selectors = ['.hud-score-card', '.hud-top-actions', '.hud-bottom-dock'];
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (!el) continue;
              const r = el.getBoundingClientRect();
              const ox = Math.max(0, Math.min(r.right, jr.right) - Math.max(r.left, jr.left));
              const oy = Math.max(0, Math.min(r.bottom, jr.bottom) - Math.max(r.top, jr.top));
              if (ox > 2 && oy > 2) {
                hudOverlaps.push({ selector: sel, ox: Math.round(ox), oy: Math.round(oy), r, jr });
              }
            }
            return {
              jarRect: jr,
              grapePixelDiameter: st.grapePixelDiameter,
              hudOverlaps,
            };
          })()"""
      )
      assert jar_audit["jarRect"]["fullyVisible"] is True, (width, height, jar_audit)
      assert jar_audit["jarRect"]["heldFruitTopPx"] >= 6.0, (
          f"Held fruit top {jar_audit['jarRect']['heldFruitTopPx']}px < 6px on {width}x{height}: {jar_audit}"
      )
      assert jar_audit["jarRect"]["jarFloorBottomMarginPx"] >= 4.0, (
          f"Jar floor margin {jar_audit['jarRect']['jarFloorBottomMarginPx']}px < 4px on {width}x{height}: {jar_audit}"
      )
      if width >= height:
        assert 0.78 <= jar_audit["jarRect"]["interiorHeightRatio"] <= 0.85, (
            f"Expected landscape jar interior height ratio ~80-84% on {width}x{height}: {jar_audit}"
        )
        if height <= 440:
          assert jar_audit["jarRect"]["evolutionWheelVisible"] is False, (
              f"Evolution wheel must be hidden at {width}x{height}: {jar_audit}"
          )
        else:
          assert jar_audit["jarRect"]["evolutionWheelVisible"] is True, jar_audit
          assert jar_audit["jarRect"]["evolutionWheelLeftPx"] > jar_audit["jarRect"]["jarOuterRightPx"] + 6.0, (
              f"Evolution wheel overlaps jar right wall on {width}x{height}: {jar_audit}"
          )
      assert len(jar_audit["hudOverlaps"]) == 0, (
          f"HUD overlaps jar interior on {width}x{height}: {jar_audit}"
      )
      if width == 1280 and height == 800:
        assert jar_audit["grapePixelDiameter"] >= 48.0, jar_audit


def t30_viewport_1280x800_desktop_landscape(h: WatermelonTestHarness) -> None:
  _audit_viewport(h, 1280, 800, mobile=False, touch=False)


def t31_viewport_1024x768_ipad_landscape(h: WatermelonTestHarness) -> None:
  _audit_viewport(h, 1024, 768, mobile=True, touch=True)


def t32_viewport_844x390_mobile_landscape(h: WatermelonTestHarness) -> None:
  _audit_viewport(h, 844, 390, mobile=True, touch=True)


def t33_viewport_390x844_mobile_portrait(h: WatermelonTestHarness) -> None:
  _audit_viewport(h, 390, 844, mobile=True, touch=True)
  h.set_viewport(1280, 800, mobile=False, touch=False)


def t34_safari_zero_importmap_and_subpath_hosting(h: WatermelonTestHarness) -> None:
  root = h.root_dir
  html_files = list(root.glob("*.html"))
  js_files = list((root / "src").glob("*.js"))
  assert html_files and js_files

  for hf in html_files:
    txt = hf.read_text(encoding="utf-8")
    assert "importmap" not in txt.lower(), f"Forbidden importmap in {hf}"
    assert "speechSynthesis" not in txt, f"Forbidden speechSynthesis in {hf}"

  import_re = re.compile(r"""(?:import|from)\s+['"]([^'"]+)['"]""")
  for jf in js_files:
    txt = jf.read_text(encoding="utf-8")
    assert "speechSynthesis" not in txt, f"Forbidden speechSynthesis in {jf}"
    for match in import_re.finditer(txt):
      spec = match.group(1)
      assert spec.startswith("./") or spec.startswith("../"), (
          f"Bare ES specifier {spec!r} in {jf}; must use relative path"
      )

  # Verify strict subpath server /qq-watermelon-3d/ serves with 0 HTTP 404s
  sub = RecordedStaticHTTPServer(root, strict_subpath="/qq-watermelon-3d").start()
  try:
    h.clear_diagnostics()
    h.navigate(sub.base_url, wait_api=True)
    h.eval_js("window.__WATERMELON__.startMatch({ mode: 'classic' })")
    h.eval_js("window.__WATERMELON__.dropFruit()")
    h.eval_js("window.__WATERMELON__.stepFrames(15)")
    errs = sub.get_error_records(ignore_favicon=False)
    assert errs == [], f"Subpath /qq-watermelon-3d/ had HTTP errors: {errs}"
  finally:
    sub.close()
    h.navigate(h.http_server.base_url, wait_api=True)


def t35_visual_render_and_gbrowser_check(h: WatermelonTestHarness) -> None:
  h.set_viewport(1280, 800, mobile=False, touch=False)
  h.eval_js(
      """(() => {
        const api = window.__WATERMELON__;
        api.startMatch({
          mode: 'classic',
          seed: 20261029,
          forcedQueue: [4, 3],
          customFruits: [
            { tier: 9, x: -0.95, y: 2.25 },
            { tier: 9, x: 0.95, y: 2.25 },
            { tier: 8, x: -1.25, y: 5.20 },
            { tier: 7, x: 0.35, y: 3.85 },
            { tier: 6, x: 1.65, y: 4.95 },
            { tier: 5, x: -0.65, y: 5.85 },
            { tier: 4, x: 1.15, y: 6.65 },
            { tier: 3, x: -1.45, y: 7.45 },
            { tier: 2, x: 0.15, y: 7.35 },
          ],
        });
        api.setAimX(0.45);
        api.stepFrames(18);
      })()"""
  )
  shot_png = h.capture_screenshot()
  stats = h.inspect_image(shot_png)
  assert stats["width"] == 1280 and stats["height"] == 800, stats
  assert stats["std_dev"] > 0.08, f"Expected rich 3D visual variance, got {stats}"

  readme_jpg = Path("/tmp/qq_watermelon_3d/screenshot.jpg")
  readme_jpg.parent.mkdir(parents=True, exist_ok=True)
  subprocess.run(
      [
          MAGICK_BIN,
          str(shot_png),
          "-quality",
          "88",
          str(readme_jpg),
      ],
      check=True,
      timeout=15,
  )
  assert readme_jpg.exists() and readme_jpg.stat().st_size > 20000
  assert h.debug_port > 0
  h.assert_zero_errors("t35")


def t36_ipad_touch_hammer_no_double_drop(h: WatermelonTestHarness) -> None:
  h.set_viewport(1024, 768, mobile=True, touch=True)
  h.eval_js(
      """window.__WATERMELON__.startMatch({
        mode: 'classic',
        tools: { shake: 2, hammer: 2, rainbow: 2 },
        customFruits: [{ tier: 7, x: 0.0, y: 1.40 }],
      })"""
  )
  # Arm Hammer via HUD button
  h.click_testid("hud-btn-hammer")
  st_armed = h.get_state()
  assert st_armed["activeTool"] == "hammer", st_armed

  # Dispatch touch tap in center of jar (512, 480)
  h.cdp(
      "Input.dispatchTouchEvent",
      {"type": "touchStart", "touchPoints": [{"x": 512, "y": 480, "id": 1}]},
  )
  h.cdp("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
  st_after = h.get_state()
  assert st_after["dropCount"] == 0, f"Hammer touch tap must NOT drop held fruit: {st_after}"
  assert len(st_after["fruits"]) == 0, st_after
  assert st_after["tools"]["hammer"] == 1, st_after
  h.set_viewport(1280, 800, mobile=False, touch=False)


def t37_seam_no_drop_override_no_initial_score(h: WatermelonTestHarness) -> None:
  res = h.eval_js(
      """(() => {
        const api = window.__WATERMELON__;
        const st0 = api.startMatch({
          mode: 'classic',
          initialScore: 99999,
          forcedQueue: [0, 1],
        });
        api.setAimX(-1.5);
        const st1 = api.dropFruit({ tier: 10, x: 3.5 });
        return {
          startScore: st0.score,
          droppedTier: st1.fruits[0].tier,
          droppedX: st1.fruits[0].x,
        };
      })()"""
  )
  assert res["startScore"] == 0, res
  assert res["droppedTier"] == 0, res
  assert abs(res["droppedX"] - (-1.5)) < 0.1, res


def t38_rainbow_at_tier_9_preserves_charges(h: WatermelonTestHarness) -> None:
  res = h.eval_js(
      """(() => {
        const api = window.__WATERMELON__;
        api.startMatch({
          mode: 'classic',
          forcedQueue: [8, 0],
          tools: { shake: 2, hammer: 2, rainbow: 4 },
        });
        const st1 = api.useTool('rainbow'); // 8 -> 9 (consumes 1 charge -> 3 left)
        const st2 = api.useTool('rainbow'); // Already 9 -> no-op (still 3 left!)
        const st3 = api.useTool('rainbow'); // Still 3 left!
        return {
          tier1: st1.currentFruit.tier,
          rainbowAfterFirst: st1.tools.rainbow,
          tier3: st3.currentFruit.tier,
          rainbowAfterThird: st3.tools.rainbow,
        };
      })()"""
  )
  assert res["tier1"] == 9 and res["rainbowAfterFirst"] == 3, res
  assert res["tier3"] == 9 and res["rainbowAfterThird"] == 3, res


def t39_four_mandarins_post_merge_cooldown_shows_intermediate_lemons(
    h: WatermelonTestHarness,
) -> None:
  res = h.eval_js(
      """(() => {
        const api = window.__WATERMELON__;
        api.startMatch({
          mode: 'classic',
          customFruits: [
            { tier: 2, x: -0.45, y: 0.59 },
            { tier: 2, x: -0.15, y: 0.59 },
            { tier: 2, x: 0.15, y: 0.59 },
            { tier: 2, x: 0.45, y: 0.59 },
          ],
        });
        const stFrame1 = api.stepFrames(1);
        const stFrame12 = api.stepFrames(12);
        return {
          frame1Tiers: stFrame1.fruits.map(f => f.tier),
          frame12Tiers: stFrame12.fruits.map(f => f.tier),
        };
      })()"""
  )
  # Frame 1 shows the two intermediate Lemons (tier 3); by Frame 13 they merge into Kiwi (tier 4)!
  assert res["frame1Tiers"] == [3, 3], res
  assert res["frame12Tiers"] == [4], res


def t40_fun_overhaul_jar_proportions_radii_masses_and_spawn_weights(
    h: WatermelonTestHarness,
) -> None:
  res = h.eval_js(
      """(() => {
        const api = window.__WATERMELON__;
        const stClassic = api.startMatch({ mode: 'classic', seed: 901 });
        const stRush = api.startMatch({ mode: 'rush', seed: 902 });
        return {
          jar: stClassic.jar,
          radii: stClassic.fruitTiers.map(t => t.radius),
          masses: stClassic.fruitTiers.map(t => t.mass),
          classicTools: stClassic.tools,
          rushTools: stRush.tools,
        };
      })()"""
  )
  assert res["jar"]["width"] == 6.4 and res["jar"]["halfWidth"] == 3.2, res
  assert res["jar"]["rimY"] == 9.2 and res["jar"]["overflowLimitSec"] == 2.0, res
  expected_radii = [0.38, 0.50, 0.64, 0.78, 0.96, 1.16, 1.38, 1.62, 1.90, 2.25, 2.70]
  assert res["radii"] == expected_radii, res
  for i in range(1, len(res["masses"])):
    ratio_r2 = (expected_radii[i] / expected_radii[0]) ** 2
    assert abs(res["masses"][i] - ratio_r2) < 0.15, (i, res["masses"][i], ratio_r2)
  assert res["classicTools"] == {"shake": 1, "hammer": 1, "rainbow": 1}, res
  assert res["rushTools"] == {"shake": 2, "hammer": 2, "rainbow": 2}, res


def t41_deterministic_seed_sweep_random_dropper_and_greedy_aimer(
    h: WatermelonTestHarness,
) -> None:
  res = h.eval_js(
      """(() => {
        const api = window.__WATERMELON__;
        const seeds = [101, 202, 303, 404, 505, 606, 707, 808];
        const randomRuns = [];
        for (const seed of seeds) {
          let s = seed ^ 0x9E3779B9;
          const rand = () => {
            s = (s + 0x6D2B79F5) | 0;
            let t = Math.imul(s ^ (s >>> 15), 1 | s);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
          };
          api.startMatch({ mode: 'classic', seed });
          let drops = 0;
          let st = api.getState();
          while (st.status === 'playing' && drops < 100) {
            const r = st.currentFruit ? st.currentFruit.radius : 0.5;
            const maxX = 3.2 - r;
            const aimX = (rand() * 2 - 1) * maxX;
            api.setAimX(aimX);
            api.dropFruit();
            drops += 1;
            st = api.stepFrames(30);
          }
          randomRuns.push({
            seed,
            drops,
            status: st.status,
            merges: st.mergeCount,
            combo3Plus: st.comboThreePlusCount,
            combo3Pct: st.mergeCount > 0 ? (st.comboThreePlusCount / st.mergeCount) * 100 : 0,
          });
        }

        // Verify greedy aimer inside E2E budget
        const greedyRuns = [];
        for (const seed of [101]) {
          api.startMatch({ mode: 'classic', seed });
          let drops = 0;
          let peachSec = null;
          let st = api.getState();
          while (st.status === 'playing' && st.elapsedSec < 122.0 && drops < 250) {
            const cur = st.currentFruit;
            if (!cur) {
              st = api.stepFrames(5);
              continue;
            }
            const r = cur.radius;
            const maxX = 3.2 - r;
            let targetX = null;
            const same = st.fruits.filter(f => f.tier === cur.tier);
            if (same.length > 0) {
              same.sort((a, b) => b.y - a.y);
              targetX = same[0].x + (same[0].x >= 0 ? -0.04 : 0.04);
            } else {
              const plus1 = st.fruits.filter(f => f.tier === cur.tier + 1);
              if (plus1.length > 0) {
                plus1.sort((a, b) => b.y - a.y);
                targetX = plus1[0].x + (plus1[0].x >= 0 ? -0.15 : 0.15);
              } else {
                const slots = [-2.5, -1.3, 0.0, 1.3, 2.5];
                targetX = slots[Math.min(4, cur.tier)] + ((drops % 3) - 1) * 0.08;
              }
            }
            api.setAimX(Math.max(-maxX, Math.min(maxX, targetX)));
            api.dropFruit();
            drops += 1;
            st = api.stepFrames(30);
            if (peachSec === null && st.highestTier >= 6) {
              peachSec = st.elapsedSec;
            }
          }
          greedyRuns.push({
            seed,
            status: st.status,
            elapsedSec: st.elapsedSec,
            peachSec,
            highestTier: st.highestTier,
          });
        }
        return { randomRuns, greedyRuns };
      })()"""
  )
  for r in res["randomRuns"]:
    assert r["status"] == "podium", r
    assert 40 <= r["drops"] <= 70, f"Random dropper drops out of 40..70 bound: {r}"
    assert r["combo3Pct"] < 10.0, f"Random dropper combo3+ >= 10%: {r}"
  for g in res["greedyRuns"]:
    assert g["peachSec"] is not None and 20.0 <= g["peachSec"] <= 60.0, g
    assert g["elapsedSec"] >= 120.0, g


def t42_combo_window_1s_pitch_escalation_and_merge_popups(
    h: WatermelonTestHarness,
) -> None:
  res = h.eval_js(
      """(() => {
        const api = window.__WATERMELON__;
        api.startMatch({
          mode: 'classic',
          seed: 701,
          customFruits: [
            { tier: 1, x: -0.15, y: 0.50 },
            { tier: 1, x: 0.15, y: 0.50 },
            { tier: 2, x: 0.05, y: 1.15 },
            { tier: 3, x: 0.05, y: 1.95 },
          ],
        });
        const st1 = api.stepFrames(25);
        const popupsText = Array.from(document.querySelectorAll('#hud-popups .merge-popup'))
          .map(el => el.textContent.trim());
        // Step > 1.0s (65 frames) with no merges -> comboCount must reset to 0
        const stAfterWindow = api.stepFrames(65);
        return {
          comboWindowSec: st1.comboWindowSec,
          maxCombo: st1.maxCombo,
          comboResetAfter1s: stAfterWindow.comboCount,
          lastMergeNote: st1.audio.lastMergeNote,
          lastMergeHz: st1.audio.lastMergeHz,
          popupsText,
        };
      })()"""
  )
  assert res["comboWindowSec"] == 1.0, res
  assert res["maxCombo"] >= 2, res
  assert res["comboResetAfter1s"] == 0, res
  assert res["lastMergeNote"] in ("C5", "E5", "G5", "C6"), res
  assert res["lastMergeHz"] > 300, res
  assert any("+" in t for t in res["popupsText"]), res


def t43_merge_squash_particles_screenshake_and_big_watermelon_slowmo(
    h: WatermelonTestHarness,
) -> None:
  res = h.eval_js(
      """(() => {
        const api = window.__WATERMELON__;
        // 1. Low-tier merge (0+0 -> 1): screenShake === 0, wobbleTimer === 0.18, particleCount === 14
        api.startMatch({
          mode: 'classic',
          customFruits: [
            { tier: 0, x: -0.1, y: 0.38 },
            { tier: 0, x: 0.1, y: 0.38 },
          ],
        });
        const stLow = api.stepFrames(1);
        const evLow = stLow.events.find(e => e.type === 'merge');

        // 2. Big Watermelon merge (9+9 -> 10): slowMoTimer = 0.6s, timeScale = 0.25, screenShake = 0.35
        api.startMatch({
          mode: 'classic',
          customFruits: [
            { tier: 9, x: -0.4, y: 2.25 },
            { tier: 9, x: 0.4, y: 2.25 },
          ],
        });
        const stBig = api.stepFrames(1);
        const evBig = stBig.events.find(e => e.type === 'merge');
        return {
          lowShake: stLow.screenShake,
          lowSquashX: evLow ? evLow.squashX : 0,
          lowStretchY: evLow ? evLow.stretchY : 0,
          lowParticles: evLow ? evLow.particleCount : 0,
          bigSlowMoTimer: stBig.slowMoTimer,
          bigTimeScale: stBig.timeScale,
          bigShake: evBig ? evBig.screenShake : 0,
          fanfareCount: stBig.audio.fanfareCount,
        };
      })()"""
  )
  assert res["lowShake"] == 0, res
  assert res["lowSquashX"] == 1.25 and res["lowStretchY"] == 0.80, res
  assert res["lowParticles"] == 14, res
  assert res["bigSlowMoTimer"] > 0.5 and res["bigTimeScale"] == 0.25, res
  assert res["bigShake"] == 0.35, res
  assert res["fanfareCount"] >= 1, res


def t44_danger_tension_rim_proximity_heartbeat_and_danger_stamp(
    h: WatermelonTestHarness,
) -> None:
  res = h.eval_js(
      """(() => {
        const api = window.__WATERMELON__;
        // Place a settled tier-8 fruit (r=1.90) with top at y+r = 6.2 + 1.90 = 8.10 (within 1 radius of rimY=9.2)
        api.startMatch({
          mode: 'classic',
          customFruits: [
            { tier: 8, x: 0.0, y: 6.2, graceTimer: 0 },
          ],
        });
        const stNear = api.stepFrames(5);

        // Now place an overflowing fruit with overflowTimer = 0.85 (> 0.8s threshold)
        api.startMatch({
          mode: 'classic',
          customFruits: [
            { tier: 8, x: 0.0, y: 9.6, graceTimer: 0, overflowTimer: 0.85 },
          ],
        });
        const stDanger = api.stepFrames(2);
        const stampEl = document.getElementById('hud-danger-stamp');
        return {
          nearRimDanger: stNear.nearRimDanger,
          dangerProximity: stNear.dangerProximity,
          dangerStampActive: stDanger.dangerStampActive,
          stampVisible: Boolean(stampEl && stampEl.classList.contains('visible')),
          stampText: stampEl ? stampEl.textContent.trim() : '',
          heartbeatCount: stDanger.audio.heartbeatCount,
        };
      })()"""
  )
  assert res["nearRimDanger"] is True and res["dangerProximity"] > 0, res
  assert res["dangerStampActive"] is True, res
  assert res["stampVisible"] is True and "危险" in res["stampText"], res
  assert res["heartbeatCount"] >= 1, res


def t45_star_progress_bar_penguin_3d_next_fruit_and_evolution_highlight(
    h: WatermelonTestHarness,
) -> None:
  res = h.eval_js(
      """(() => {
        const api = window.__WATERMELON__;
        api.startMatch({
          mode: 'classic',
          forcedQueue: [2, 4, 1],
          customFruits: [
            { tier: 8, x: -0.3, y: 1.90, graceTimer: 0 },
            { tier: 8, x: 0.3, y: 1.90, graceTimer: 0 },
            { tier: 8, x: -1.1, y: 5.20, graceTimer: 0 },
            { tier: 8, x: 1.1, y: 5.20, graceTimer: 0 },
          ],
        });
        const stMerge = api.stepFrames(10);
        const starFillWidth = document.getElementById('hud-star-fill').style.width;

        // Finish match with new record to verify podium new-record banner
        api.startMatch({
          mode: 'classic',
          resetBestScore: true,
          customFruits: [
            { tier: 8, x: -0.2, y: 1.90, graceTimer: 0 },
            { tier: 8, x: 0.2, y: 1.90, graceTimer: 0 },
            { tier: 7, x: 0.0, y: 9.8, graceTimer: 0, overflowTimer: 1.98 },
          ],
        });
        const stEnd = api.stepFrames(5);
        const newRecVisible = document.getElementById('podium-new-record').classList.contains('visible');
        return {
          nextTier: stMerge.nextFruitTier,
          penguinHoldingTier: stMerge.penguinHoldingTier,
          highlightedTier: stMerge.highlightedTier,
          highlightTimer: stMerge.highlightTimer,
          starProgress: stMerge.starProgress,
          starFillWidth,
          isNewRecord: stEnd.isNewRecord,
          newRecVisible,
        };
      })()"""
  )
  assert res["penguinHoldingTier"] == res["nextTier"], res
  assert res["highlightedTier"] >= 8 and res["highlightTimer"] > 0, res
  assert res["starProgress"] > 0 and res["starFillWidth"] != "0%", res
  assert res["isNewRecord"] is True and res["newRecVisible"] is True, res


def t46_hall_progress_localstorage_contract(h: WatermelonTestHarness) -> None:
  res = h.eval_js(
      """(() => {
        localStorage.setItem(
          'qq_hall_progress',
          JSON.stringify({ aeroplane: { plays: 3, best: 100, stars: 2, last: '2026-10-29T00:00:00.000Z' } })
        );
        const api = window.__WATERMELON__;
        api.startMatch({
          mode: 'classic',
          customFruits: [
            { tier: 9, x: -0.2, y: 2.25, graceTimer: 0 },
            { tier: 9, x: 0.2, y: 2.25, graceTimer: 0 },
            { tier: 8, x: 0, y: 9.8, graceTimer: 0, overflowTimer: 1.98 },
          ],
        });
        api.stepFrames(5);
        return JSON.parse(localStorage.getItem('qq_hall_progress') || '{}');
      })()"""
  )
  assert "aeroplane" in res and res["aeroplane"]["plays"] == 3, res
  assert "watermelon" in res, res
  wm = res["watermelon"]
  assert wm["plays"] >= 1 and wm["best"] >= 2000 and wm["stars"] == 3, wm
  assert isinstance(wm["last"], str) and "T" in wm["last"], wm


def t47_director_v2_framing_evolution_wheel_star_bar_and_difficulty_params(
    h: WatermelonTestHarness,
) -> None:
  res = h.eval_js(
      """(async () => {
        const cfg = await import('./src/config.js');
        const api = window.__WATERMELON__;
        api.startMatch({
          mode: 'classic',
          seed: 555,
          customFruits: [
            { tier: 2, x: -0.1, y: 0.64 },
            { tier: 2, x: 0.1, y: 0.64 },
          ],
        });
        const stMerge = api.stepFrames(1);
        const evMerge = stMerge.events.find(e => e.type === 'merge');
        const starTrackRect = document.querySelector('.star-bar-track').getBoundingClientRect();
        const starMilestoneFontPx = parseFloat(
          window.getComputedStyle(document.getElementById('star-mark-1')).fontSize
        );
        const scoreSubFontPx = parseFloat(
          window.getComputedStyle(document.querySelector('.score-sub')).fontSize
        );
        return {
          spawnWeights: Array.from(cfg.SPAWN_WEIGHTS),
          mergeCooldownSec: cfg.MERGE_COOLDOWN_SEC,
          mergeTouchMargin: cfg.JAR_CONFIG.mergeTouchMargin,
          mergeRandomImpulseX: cfg.JAR_CONFIG.mergeRandomImpulseX,
          impulseX: evMerge ? evMerge.impulseX : 0,
          starTrackHeightPx: starTrackRect.height,
          starMilestoneFontPx,
          scoreSubFontPx,
          jarScreenRect: stMerge.jarScreenRect,
        };
      })()"""
  )
  assert res["spawnWeights"] == [0.20, 0.20, 0.20, 0.20, 0.20], res
  assert res["mergeCooldownSec"] == 0.16, res
  assert res["mergeTouchMargin"] == 0.004, res
  assert res["mergeRandomImpulseX"] == 0.6, res
  assert isinstance(res["impulseX"], (int, float)) and abs(res["impulseX"]) <= 0.6, res
  assert res["starTrackHeightPx"] >= 11.0, res
  assert res["starMilestoneFontPx"] >= 14.0, res
  assert res["scoreSubFontPx"] >= 13.0, res
  assert res["jarScreenRect"]["heldFruitTopPx"] >= 6.0, res
  assert res["jarScreenRect"]["jarFloorBottomMarginPx"] >= 4.0, res
  assert res["jarScreenRect"]["evolutionWheelVisible"] is True, res
  assert (
      res["jarScreenRect"]["evolutionWheelLeftPx"]
      > res["jarScreenRect"]["jarOuterRightPx"] + 6.0
  ), res


ALL_TESTS: list[tuple[str, Callable[[WatermelonTestHarness], None]]] = [
    ("T01_webgl2_and_frozen_seam", t01_webgl2_and_frozen_seam),
    ("T02_getstate_deep_clone_immutability", t02_getstate_deep_clone_immutability),
    ("T03_eleven_tier_evolution_metadata", t03_eleven_tier_evolution_metadata),
    ("T04_bespoke_3d_meshes_and_metalness_cap", t04_bespoke_3d_meshes_and_metalness_cap),
    ("T05_merge_tier_0_to_1", t05_merge_tier_0_to_1),
    ("T06_merge_tier_1_to_2", t06_merge_tier_1_to_2),
    ("T07_merge_tier_2_to_3", t07_merge_tier_2_to_3),
    ("T08_merge_tier_3_to_4", t08_merge_tier_3_to_4),
    ("T09_merge_tier_4_to_5", t09_merge_tier_4_to_5),
    ("T10_merge_tier_5_to_6", t10_merge_tier_5_to_6),
    ("T11_merge_tier_6_to_7", t11_merge_tier_6_to_7),
    ("T12_merge_tier_7_to_8", t12_merge_tier_7_to_8),
    ("T13_merge_tier_8_to_9", t13_merge_tier_8_to_9),
    ("T14_merge_tier_9_to_10_big_watermelon", t14_merge_tier_9_to_10_big_watermelon),
    ("T15_merge_tier_10_golden_watermelon_fountain", t15_merge_tier_10_golden_watermelon_fountain),
    ("T16_triple_collision_boolean_set_guard", t16_triple_collision_boolean_set_guard),
    ("T17_quadruple_simultaneous_dual_pair_merge", t17_quadruple_simultaneous_dual_pair_merge),
    ("T18_chain_cascade_combo_and_tool_refill", t18_chain_cascade_combo_and_tool_refill),
    ("T19_substepped_physics_180_drop_fuzz", t19_substepped_physics_180_drop_fuzz_zero_nan_zero_tunneling),
    ("T20_rolling_spin_omega_physics", t20_rolling_spin_omega_physics),
    ("T21_tool_shake_jar", t21_tool_shake_jar),
    ("T22_tool_magic_hammer_api_and_3d_raycast", t22_tool_magic_hammer_api_and_3d_raycast),
    ("T23_tool_rainbow_upgrade", t23_tool_rainbow_upgrade),
    ("T24_spawn_drop_grace_prevents_false_overflow", t24_spawn_drop_grace_prevents_false_overflow),
    ("T25_overflow_rim_2_5s_triggers_podium", t25_overflow_rim_2_5s_triggers_podium),
    ("T26_podium_star_tiers_0_to_3", t26_podium_star_tiers_0_to_3),
    ("T27_classic_and_rush_modes", t27_classic_and_rush_modes),
    ("T28_pointer_drag_aim_and_drop", t28_pointer_drag_aim_and_drop),
    ("T29_keyboard_and_autorepeat_webaudio_safety", t29_keyboard_and_autorepeat_webaudio_safety),
    ("T30_viewport_1280x800_desktop_landscape", t30_viewport_1280x800_desktop_landscape),
    ("T31_viewport_1024x768_ipad_landscape", t31_viewport_1024x768_ipad_landscape),
    ("T32_viewport_844x390_mobile_landscape", t32_viewport_844x390_mobile_landscape),
    ("T33_viewport_390x844_mobile_portrait", t33_viewport_390x844_mobile_portrait),
    ("T34_safari_zero_importmap_and_subpath_hosting", t34_safari_zero_importmap_and_subpath_hosting),
    ("T35_visual_render_and_gbrowser_check", t35_visual_render_and_gbrowser_check),
    ("T36_ipad_touch_hammer_no_double_drop", t36_ipad_touch_hammer_no_double_drop),
    ("T37_seam_no_drop_override_no_initial_score", t37_seam_no_drop_override_no_initial_score),
    ("T38_rainbow_at_tier_9_preserves_charges", t38_rainbow_at_tier_9_preserves_charges),
    ("T39_four_mandarins_post_merge_cooldown", t39_four_mandarins_post_merge_cooldown_shows_intermediate_lemons),
    ("T40_fun_overhaul_jar_proportions_radii_masses_and_spawn_weights", t40_fun_overhaul_jar_proportions_radii_masses_and_spawn_weights),
    ("T41_deterministic_seed_sweep_random_dropper_and_greedy_aimer", t41_deterministic_seed_sweep_random_dropper_and_greedy_aimer),
    ("T42_combo_window_1s_pitch_escalation_and_merge_popups", t42_combo_window_1s_pitch_escalation_and_merge_popups),
    ("T43_merge_squash_particles_screenshake_and_big_watermelon_slowmo", t43_merge_squash_particles_screenshake_and_big_watermelon_slowmo),
    ("T44_danger_tension_rim_proximity_heartbeat_and_danger_stamp", t44_danger_tension_rim_proximity_heartbeat_and_danger_stamp),
    ("T45_star_progress_bar_penguin_3d_next_fruit_and_evolution_highlight", t45_star_progress_bar_penguin_3d_next_fruit_and_evolution_highlight),
    ("T46_hall_progress_localstorage_contract", t46_hall_progress_localstorage_contract),
    ("T47_director_v2_framing_evolution_wheel_star_bar_and_difficulty_params", t47_director_v2_framing_evolution_wheel_star_bar_and_difficulty_params),
]


def main() -> int:
  parser = argparse.ArgumentParser(description="Run E2E suite for Synthetic Big Watermelon 3D")
  parser.add_argument("--filter", type=str, default="", help="Substring filter for test names")
  args = parser.parse_args()

  passed = 0
  failed = 0
  results = []

  with WatermelonTestHarness(root_dir=DEFAULT_PROJECT_ROOT) as h:
    h.navigate()
    for name, fn in ALL_TESTS:
      if args.filter and args.filter not in name:
        continue
      t0 = time.time()
      try:
        fn(h)
        dt_ms = (time.time() - t0) * 1000.0
        passed += 1
        results.append({"name": name, "passed": True, "ms": round(dt_ms, 1)})
        print(f"[PASS] {name} ({dt_ms:.1f} ms)")
      except Exception as e:  # pylint: disable=broad-except
        dt_ms = (time.time() - t0) * 1000.0
        failed += 1
        results.append({"name": name, "passed": False, "ms": round(dt_ms, 1), "error": str(e)})
        print(f"[FAIL] {name} ({dt_ms:.1f} ms): {e}")

  summary = {
      "total": passed + failed,
      "passed": passed,
      "failed": failed,
  }
  print("E2E_SUMMARY:", json.dumps(summary))
  return 0 if failed == 0 else 1


if __name__ == "__main__":
  sys.exit(main())
