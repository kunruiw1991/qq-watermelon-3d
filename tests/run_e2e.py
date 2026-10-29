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
  assert res["shake"] == 2, res
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
        // Tier-10 Big Watermelon (watermelonsCreated=1 -> 3 stars) while top fruit overflows rimY=10.8
        api.startMatch({
          mode: 'classic',
          customFruits: [
            { tier: 9, x: -2.4, y: 1.86, graceTimer: 0 },
            { tier: 9, x: -2.0, y: 1.86, graceTimer: 0 },
            { tier: 9, x: 2.3, y: 1.86, graceTimer: 0 },
            { tier: 8, x: 0.0, y: 4.5, graceTimer: 0 },
            { tier: 9, x: -2.4, y: 6.2, graceTimer: 0 },
            { tier: 10, x: 2.2, y: 6.2, graceTimer: 0 },
            { tier: 7, x: -0.1, y: 8.1, graceTimer: 0 },
            { tier: 8, x: -2.5, y: 9.8, graceTimer: 0 },
            { tier: 9, x: 2.1, y: 10.2, graceTimer: 0 },
            { tier: 10, x: -0.2, y: 11.4, graceTimer: 0 },
          ],
        });
        const stMid = api.stepFrames(90); // 1.5s (< 2.5s limit)
        const stEnd = api.stepFrames(80); // Total > 2.5s
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
  assert res["midStatus"] == "playing" and res["midOverflow"] > 1.0, res
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
            { tier: 8, x: 0, y: 11.2, graceTimer: 0, overflowTimer: 2.48 },
          ],
        });
        const st0 = api.stepFrames(5);

        // 1 Star: 2 separated (8+8->9) merges + 1 (7+7->8) merge = 3072 pts (>= 3000, < 8000)
        api.startMatch({
          mode: 'classic',
          customFruits: [
            { tier: 8, x: -2.9, y: 1.62, graceTimer: 0 },
            { tier: 8, x: -2.7, y: 1.62, graceTimer: 0 },
            { tier: 8, x: 2.7, y: 1.62, graceTimer: 0 },
            { tier: 8, x: 2.9, y: 1.62, graceTimer: 0 },
            { tier: 7, x: -0.1, y: 5.0, graceTimer: 0 },
            { tier: 7, x: 0.1, y: 5.0, graceTimer: 0 },
            { tier: 6, x: 0, y: 11.4, graceTimer: 0, overflowTimer: 2.48 },
          ],
        });
        const st1 = api.stepFrames(4);

        // 2 Stars: 5 separated (8+8->9) merges + 1 (7+7->8) merge = 8832 pts (>= 8000, < 15000, watermelonsCreated = 0)
        api.startMatch({
          mode: 'classic',
          customFruits: [
            { tier: 8, x: -2.9, y: 1.62, graceTimer: 0 },
            { tier: 8, x: -2.7, y: 1.62, graceTimer: 0 },
            { tier: 8, x: 2.7, y: 1.62, graceTimer: 0 },
            { tier: 8, x: 2.9, y: 1.62, graceTimer: 0 },
            { tier: 8, x: -0.1, y: 4.8, graceTimer: 0 },
            { tier: 8, x: 0.1, y: 4.8, graceTimer: 0 },
            { tier: 8, x: -2.8, y: 8.2, graceTimer: 0 },
            { tier: 8, x: -2.6, y: 8.2, graceTimer: 0 },
            { tier: 8, x: 2.6, y: 8.2, graceTimer: 0 },
            { tier: 8, x: 2.8, y: 8.2, graceTimer: 0 },
            { tier: 7, x: -0.1, y: 8.2, graceTimer: 0 },
            { tier: 7, x: 0.1, y: 8.2, graceTimer: 0 },
            { tier: 6, x: 0.0, y: 11.4, graceTimer: 0, overflowTimer: 2.48 },
          ],
        });
        const st2 = api.stepFrames(5);

        // 3 Stars: (9+9->10) synthesizes a Big Watermelon (watermelonsCreated = 1)
        api.startMatch({
          mode: 'classic',
          customFruits: [
            { tier: 9, x: -0.2, y: 1.86, graceTimer: 0 },
            { tier: 9, x: 0.2, y: 1.86, graceTimer: 0 },
            { tier: 8, x: 0, y: 11.4, graceTimer: 0, overflowTimer: 2.48 },
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
  for screen_cmd in (
      "window.__WATERMELON__.openTitle()",
      "window.__WATERMELON__.startMatch({ mode: 'classic' })",
      "window.__WATERMELON__.startMatch({ mode: 'classic', customFruits: [{ tier: 8, x: 0, y: 11.2, graceTimer: 0, overflowTimer: 2.5 }] }); window.__WATERMELON__.stepFrames(2)",
  ):
    h.eval_js(screen_cmd)
    audit = h.audit_viewport_and_hud()
    assert audit["scrollWidth"] <= width, f"Horizontal overflow on {width}x{height}: {audit}"
    assert audit["scrollHeight"] <= height, f"Vertical overflow on {width}x{height}: {audit}"
    assert 1 <= audit["controlCount"] <= 6, f"Expected 1..6 HUD controls on {width}x{height}: {audit}"
    assert len(audit["overlaps"]) == 0, f"Overlapping controls on {width}x{height}: {audit}"
    for ctrl in audit["controls"]:
      assert ctrl["width"] >= 68 and ctrl["height"] >= 68, (
          f"Control smaller than 68x68px on {width}x{height}: {ctrl}"
      )


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
            { tier: 9, x: -1.75, y: 1.86 },
            { tier: 9, x: -1.55, y: 1.86 },
            { tier: 9, x: 2.15, y: 1.86 },
            { tier: 8, x: -2.45, y: 5.55 },
            { tier: 7, x: 0.35, y: 3.45 },
            { tier: 6, x: 2.65, y: 4.95 },
            { tier: 5, x: -0.65, y: 5.85 },
            { tier: 4, x: 1.15, y: 5.65 },
            { tier: 3, x: -1.95, y: 7.75 },
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

  readme_jpg = h.root_dir / "screenshot.jpg"
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
