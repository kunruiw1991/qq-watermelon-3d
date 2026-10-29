/**
 * @fileoverview Three.js r170 3D WebGL2 renderer for Synthetic Big Watermelon 3D (合成大西瓜 3D).
 *
 * Features:
 * - 11 bespoke 3D fruit models (Grape..Big Watermelon) with stems, leaves, seeds,
 *   stripes, crowns, and kawaii 3D faces (metalness <= 0.22, zero plain spheres).
 * - Bevelled 3D crystal jar on a warm oak tabletop with dashed overflow warning rim.
 * - 3D QQ Penguin cheerleader + 3D 11-tier Fruit Evolution Ring on the sides.
 * - Glowing vertical laser drop guide + 3D landing ring + 3D Cloud Claw dropper.
 * - 3D juice-droplet particle system, shockwave rings, 3D Magic Hammer swing,
 *   Golden Watermelon Fountain fireworks, and 3D Top-3 Star Podium.
 */

import * as THREE from '../vendor/three.module.min.js';
import { FRUIT_TIERS, JAR_CONFIG } from './config.js';

export class WatermelonRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xfff4e0);
    this.scene.fog = new THREE.FogExp2(0xfff4e0, 0.009);

    this.camera = new THREE.PerspectiveCamera(40, 16 / 10, 0.5, 120);
    this.cameraTarget = new THREE.Vector3(0, 5.9, 0);

    this.renderer = null;
    this.webgl2Supported = false;
    this._initRenderer();

    this.rootGroup = new THREE.Group();
    this.scene.add(this.rootGroup);

    this.jarGroup = new THREE.Group();
    this.rootGroup.add(this.jarGroup);

    this.fruitsGroup = new THREE.Group();
    this.jarGroup.add(this.fruitsGroup);

    this.fxGroup = new THREE.Group();
    this.jarGroup.add(this.fxGroup);

    this.podiumGroup = new THREE.Group();
    this.podiumGroup.visible = false;
    this.rootGroup.add(this.podiumGroup);

    this.fruitMeshes = new Map(); // fruit.id -> THREE.Group
    this.particles = [];
    this.shockwaves = [];
    this.hammerAnims = [];
    this.processedEventFrame = -1;
    this.processedEventCount = 0;

    this.heldFruitGroup = null;
    this.heldFruitTier = -1;
    this.laserLine = null;
    this.landingRing = null;
    this.warningRimGroup = null;
    this.rimGlowMesh = null;
    this.rimGlowMat = null;
    this.penguinGroup = null;
    this.penguinHeldSlot = null;
    this.penguinHeldMesh = null;
    this.penguinNextTier = -1;
    this.penguinBounceTimer = 0;
    this.evolutionRingItems = [];
    this.podiumStars = [];
    this.podiumTrophy = null;
    this.cheerTimer = 0;
    this.clockTime = 0;

    this.raycaster = new THREE.Raycaster();
    this.pointerNdc = new THREE.Vector2();
    this.jarPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

    this._setupLights();
    this._buildEnvironmentAndJar();
    this._buildDropperAndLaser();
    this._buildQQPenguinCheerleader();
    this._buildEvolutionRing();
    this._buildPodium3D();
    this.resize();
  }

  _initRenderer() {
    try {
      const gl =
        this.canvas.getContext('webgl2', {
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
          preserveDrawingBuffer: true,
        }) ||
        this.canvas.getContext('webgl', {
          antialias: true,
          preserveDrawingBuffer: true,
        });
      this.webgl2Supported = Boolean(
        gl && typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext
      );
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        context: gl || undefined,
        antialias: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true,
      });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.12;
    } catch (_) {
      this.renderer = null;
    }
  }

  _setupLights() {
    const hemi = new THREE.HemisphereLight(0xfffbeb, 0xfde68a, 1.35);
    hemi.position.set(0, 22, 8);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffffff, 1.45);
    sun.position.set(9, 18, 15);
    this.scene.add(sun);

    const warmFill = new THREE.DirectionalLight(0xffedd5, 0.78);
    warmFill.position.set(-11, 10, 12);
    this.scene.add(warmFill);

    const rimLight = new THREE.PointLight(0xfef08a, 0.9, 28);
    rimLight.position.set(0, 11, -5);
    this.scene.add(rimLight);
  }

  _createWoodGrainTexture() {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const ctx = c.getContext('2d');
    if (ctx) {
      const grad = ctx.createLinearGradient(0, 0, 0, 512);
      grad.addColorStop(0, '#c27838');
      grad.addColorStop(0.5, '#b4692c');
      grad.addColorStop(1, '#9a5420');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 512, 512);

      // Plank seams & wood grain fibers
      const plankCount = 8;
      const plankH = 512 / plankCount;
      for (let p = 0; p < plankCount; p++) {
        const y0 = p * plankH;
        ctx.fillStyle = p % 2 === 0 ? 'rgba(255, 228, 181, 0.08)' : 'rgba(67, 26, 3, 0.08)';
        ctx.fillRect(0, y0, 512, plankH);

        // Wood grain streaks
        ctx.strokeStyle = 'rgba(78, 34, 8, 0.22)';
        ctx.lineWidth = 2;
        for (let g = 0; g < 14; g++) {
          const gy = y0 + ((g + 0.5) / 14) * plankH;
          ctx.beginPath();
          ctx.moveTo(0, gy);
          for (let x = 32; x <= 512; x += 32) {
            const wave = Math.sin(x * 0.03 + p * 1.7 + g * 0.6) * 2.8;
            ctx.lineTo(x, gy + wave);
          }
          ctx.stroke();
        }

        // Dark bevel groove between planks
        ctx.fillStyle = 'rgba(54, 21, 5, 0.58)';
        ctx.fillRect(0, y0, 512, 3);
        ctx.fillStyle = 'rgba(254, 215, 170, 0.22)';
        ctx.fillRect(0, y0 + 3, 512, 2);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 2);
    return tex;
  }

  _createWarmBackdropTexture() {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const ctx = c.getContext('2d');
    if (ctx) {
      // Warm sunlit peach-to-honey wall gradient
      const wallGrad = ctx.createLinearGradient(0, 0, 0, 512);
      wallGrad.addColorStop(0, '#fde68a');
      wallGrad.addColorStop(0.45, '#fed7aa');
      wallGrad.addColorStop(0.78, '#fdba74');
      wallGrad.addColorStop(1, '#d97706');
      ctx.fillStyle = wallGrad;
      ctx.fillRect(0, 0, 512, 512);

      // Soft diagonal sunbeams from top-left window
      ctx.save();
      ctx.fillStyle = 'rgba(255, 251, 235, 0.22)';
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(60 + i * 110, 0);
        ctx.lineTo(130 + i * 110, 0);
        ctx.lineTo(290 + i * 110, 512);
        ctx.lineTo(190 + i * 110, 512);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      // Subtle decorative wallpaper stripes
      ctx.fillStyle = 'rgba(180, 83, 9, 0.06)';
      for (let x = 0; x < 512; x += 32) {
        ctx.fillRect(x, 0, 12, 410);
      }

      // Warm wood wainscot molding at bottom of wall
      ctx.fillStyle = '#92400e';
      ctx.fillRect(0, 405, 512, 10);
      ctx.fillStyle = '#b45309';
      ctx.fillRect(0, 415, 512, 97);
      ctx.strokeStyle = 'rgba(69, 26, 3, 0.35)';
      ctx.lineWidth = 3;
      for (let x = 16; x < 512; x += 64) {
        ctx.strokeRect(x, 426, 48, 72);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _createContactShadowTexture() {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d');
    if (ctx) {
      const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
      g.addColorStop(0, 'rgba(45, 18, 4, 0.52)');
      g.addColorStop(0.55, 'rgba(45, 18, 4, 0.26)');
      g.addColorStop(1, 'rgba(45, 18, 4, 0.0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    }
    return new THREE.CanvasTexture(c);
  }

  _buildEnvironmentAndJar() {
    const hw = JAR_CONFIG.halfWidth;
    const rimY = JAR_CONFIG.rimY;
    const wallT = JAR_CONFIG.wallThickness;
    const depth = JAR_CONFIG.depth;

    // 1. Procedural Wood-Plank Oak Tabletop + 3D Bevelled Planks + Contact Shadows
    const woodTex = this._createWoodGrainTexture();
    const tableMat = new THREE.MeshStandardMaterial({
      map: woodTex,
      color: 0xeab376,
      roughness: 0.46,
      metalness: 0.06,
    });
    const tableMesh = new THREE.Mesh(new THREE.BoxGeometry(25, 1.2, 11.5), tableMat);
    tableMesh.position.set(0, -0.96, -0.2);
    this.rootGroup.add(tableMesh);

    // 3D Raised Oak Planks with dark walnut seam grooves for tactile depth
    const plankLightMat = new THREE.MeshStandardMaterial({
      map: woodTex,
      color: 0xd99b52,
      roughness: 0.42,
      metalness: 0.06,
    });
    const plankDarkMat = new THREE.MeshStandardMaterial({
      map: woodTex,
      color: 0xc07d38,
      roughness: 0.45,
      metalness: 0.06,
    });
    const plankCount = 11;
    const plankWidth = 24.2 / plankCount;
    for (let i = 0; i < plankCount; i++) {
      const plank = new THREE.Mesh(
        new THREE.BoxGeometry(plankWidth * 0.94, 0.14, 10.8),
        i % 2 === 0 ? plankLightMat : plankDarkMat
      );
      plank.position.set(
        -12.1 + plankWidth * (i + 0.5),
        -0.31,
        -0.2
      );
      this.rootGroup.add(plank);
    }

    const tableTrimMat = new THREE.MeshStandardMaterial({
      color: 0x78350f,
      roughness: 0.36,
      metalness: 0.12,
    });
    const tableTrim = new THREE.Mesh(new THREE.BoxGeometry(25.4, 0.26, 0.45), tableTrimMat);
    tableTrim.position.set(0, -0.36, 5.35);
    this.rootGroup.add(tableTrim);

    // Soft Contact Shadows on Tabletop under Jar, Penguin & Evolution Ring Stand
    const shadowTex = this._createContactShadowTexture();
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
    });
    const jarShadow = new THREE.Mesh(new THREE.PlaneGeometry(12.2, 4.4), shadowMat);
    jarShadow.rotation.x = -Math.PI * 0.5;
    jarShadow.position.set(0, -0.22, 0.1);
    this.rootGroup.add(jarShadow);

    const penguinShadow = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 3.4), shadowMat);
    penguinShadow.rotation.x = -Math.PI * 0.5;
    penguinShadow.position.set(-4.88, -0.22, 0.25);
    this.rootGroup.add(penguinShadow);

    const ringShadow = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.2), shadowMat);
    ringShadow.rotation.x = -Math.PI * 0.5;
    ringShadow.position.set(4.95, -0.22, -0.1);
    this.rootGroup.add(ringShadow);

    // Warm Sunlit Wallpaper Backdrop with Wainscot & Arched Window
    const backdropTex = this._createWarmBackdropTexture();
    const backdropMat = new THREE.MeshStandardMaterial({
      map: backdropTex,
      roughness: 0.65,
      metalness: 0.04,
    });
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(36, 24), backdropMat);
    backdrop.position.set(0, 8.8, -4.6);
    this.rootGroup.add(backdrop);

    // 2. Crystal Jar Floor Base & Left/Right Walls
    const crystalWallMat = new THREE.MeshPhysicalMaterial({
      color: 0xe0f2fe,
      transparent: true,
      opacity: 0.52,
      roughness: 0.15,
      metalness: 0.08,
      clearcoat: 0.8,
    });
    const goldCapMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      roughness: 0.28,
      metalness: 0.18,
    });

    // Jar Floor
    const floorGeo = new THREE.BoxGeometry(JAR_CONFIG.width + wallT * 2.4, 0.42, depth);
    const floorMesh = new THREE.Mesh(floorGeo, goldCapMat);
    floorMesh.position.set(0, -0.21, 0);
    this.jarGroup.add(floorMesh);

    // Velvet inner floor pad
    const padMat = new THREE.MeshStandardMaterial({
      color: 0xfef9c3,
      roughness: 0.35,
      metalness: 0.05,
    });
    const padMesh = new THREE.Mesh(
      new THREE.BoxGeometry(JAR_CONFIG.width, 0.08, depth * 0.88),
      padMat
    );
    padMesh.position.set(0, -0.02, 0);
    this.jarGroup.add(padMesh);

    // Left & Right Crystal Walls
    const wallHeight = rimY + 0.5;
    const wallGeo = new THREE.BoxGeometry(wallT, wallHeight, depth);
    const leftWall = new THREE.Mesh(wallGeo, crystalWallMat);
    leftWall.position.set(-hw - wallT * 0.5, wallHeight * 0.5 - 0.1, 0);
    this.jarGroup.add(leftWall);

    const rightWall = new THREE.Mesh(wallGeo, crystalWallMat);
    rightWall.position.set(hw + wallT * 0.5, wallHeight * 0.5 - 0.1, 0);
    this.jarGroup.add(rightWall);

    // Golden brass corner pillars & caps
    const pillarGeo = new THREE.CylinderGeometry(0.14, 0.14, wallHeight + 0.2, 16);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const pillar = new THREE.Mesh(pillarGeo, goldCapMat);
        pillar.position.set(
          sx * (hw + wallT * 0.85),
          wallHeight * 0.5,
          sz * (depth * 0.45)
        );
        this.jarGroup.add(pillar);

        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), goldCapMat);
        cap.position.set(
          sx * (hw + wallT * 0.85),
          wallHeight + 0.12,
          sz * (depth * 0.45)
        );
        this.jarGroup.add(cap);
      }
    }

    // Translucent Crystal Backplate with subtle grid stripes
    const backMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.32,
      roughness: 0.25,
      metalness: 0.04,
    });
    const backMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(JAR_CONFIG.width, wallHeight),
      backMat
    );
    backMesh.position.set(0, wallHeight * 0.5, -depth * 0.46);
    this.jarGroup.add(backMesh);

    // 3. Dashed Red/Gold Overflow Warning Rim + Danger Glow Halo at y = JAR_CONFIG.rimY
    this.warningRimGroup = new THREE.Group();
    this.warningRimGroup.position.set(0, rimY, depth * 0.42);
    const dashCount = 13;
    const dashStep = JAR_CONFIG.width / dashCount;
    const dashGeo = new THREE.BoxGeometry(dashStep * 0.62, 0.12, 0.12);
    this.warningDashMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xdc2626,
      emissiveIntensity: 0.35,
      roughness: 0.25,
      metalness: 0.1,
    });
    for (let i = 0; i < dashCount; i++) {
      const dash = new THREE.Mesh(dashGeo, this.warningDashMat);
      dash.position.x = -hw + dashStep * (i + 0.5);
      this.warningRimGroup.add(dash);
    }

    this.rimGlowMat = new THREE.MeshBasicMaterial({
      color: 0xff2222,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
    });
    this.rimGlowMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(JAR_CONFIG.width + 0.18, 0.42),
      this.rimGlowMat
    );
    this.rimGlowMesh.position.set(0, 0, -0.04);
    this.warningRimGroup.add(this.rimGlowMesh);
    this.jarGroup.add(this.warningRimGroup);
  }

  _buildDropperAndLaser() {
    this.dropperGroup = new THREE.Group();
    this.dropperGroup.position.set(0, JAR_CONFIG.spawnY, 0);
    this.jarGroup.add(this.dropperGroup);

    // Cute 3D QQ Cloud Claw Dropper above the held fruit
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.25,
      metalness: 0.06,
    });
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      roughness: 0.25,
      metalness: 0.18,
    });

    const clawCap = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.46, 0.22, 20), goldMat);
    clawCap.position.y = 0.68;
    this.dropperGroup.add(clawCap);
    this.clawCap = clawCap;
    this.cloudPuffs = [];

    for (const ox of [-0.36, 0, 0.36]) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), cloudMat);
      puff.position.set(ox, 0.84 + (ox === 0 ? 0.05 : 0), 0.1);
      this.dropperGroup.add(puff);
      this.cloudPuffs.push({ mesh: puff, ox });
    }

    // Glowing vertical laser drop guide line
    const laserMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.65,
    });
    this.laserLine = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 1.0, 10),
      laserMat
    );
    this.jarGroup.add(this.laserLine);

    // 3D Ghost Landing Ring on projected drop surface
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
    });
    this.landingRing = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.98, 28), ringMat);
    this.jarGroup.add(this.landingRing);
  }

  _buildQQPenguinCheerleader() {
    // Bespoke 3D QQ Penguin Cheerleader standing left of the jar
    this.penguinGroup = new THREE.Group();
    this.penguinGroup.position.set(-6.55, 0.1, 0.35);
    this.penguinGroup.rotation.y = 0.32;
    this.rootGroup.add(this.penguinGroup);

    // Pedestal coaster
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(1.25, 1.4, 0.36, 24),
      new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.3, metalness: 0.15 })
    );
    pedestal.position.y = 0.18;
    this.penguinGroup.add(pedestal);

    const blackMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.28,
      metalness: 0.12,
    });
    const whiteMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.22,
      metalness: 0.05,
    });
    const orangeMat = new THREE.MeshStandardMaterial({
      color: 0xf97316,
      roughness: 0.25,
      metalness: 0.1,
    });
    const scarfMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      roughness: 0.32,
      metalness: 0.08,
    });

    this.penguinBody = new THREE.Group();
    this.penguinBody.position.y = 0.36;
    this.penguinGroup.add(this.penguinBody);

    // Torso
    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.95, 24, 20), blackMat);
    torso.scale.set(1.0, 1.18, 0.92);
    torso.position.y = 1.1;
    this.penguinBody.add(torso);

    // White belly patch
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.78, 22, 18), whiteMat);
    belly.scale.set(0.92, 1.05, 0.55);
    belly.position.set(0, 1.02, 0.52);
    this.penguinBody.add(belly);

    // Classic Red QQ Scarf + Tail
    const scarfRing = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.16, 14, 28), scarfMat);
    scarfRing.rotation.x = Math.PI * 0.5;
    scarfRing.position.set(0, 1.72, 0.05);
    this.penguinBody.add(scarfRing);

    const scarfTail = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.62, 0.14), scarfMat);
    scarfTail.position.set(0.38, 1.42, 0.72);
    scarfTail.rotation.z = -0.22;
    this.penguinBody.add(scarfTail);

    // Eyes + Specular Catchlights
    for (const sx of [-1, 1]) {
      const eyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 12), whiteMat);
      eyeWhite.scale.set(0.85, 1.15, 0.5);
      eyeWhite.position.set(sx * 0.28, 2.0, 0.74);
      this.penguinBody.add(eyeWhite);

      const pupil = new THREE.Mesh(
        new THREE.SphereGeometry(0.11, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0x0f172a })
      );
      pupil.position.set(sx * 0.26, 2.0, 0.83);
      this.penguinBody.add(pupil);

      const glint = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      glint.position.set(sx * 0.23, 2.05, 0.89);
      this.penguinBody.add(glint);
    }

    // Smiling Orange Beak
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.36, 16), orangeMat);
    beak.rotation.x = Math.PI * 0.5;
    beak.scale.set(1.35, 1.0, 0.65);
    beak.position.set(0, 1.82, 0.95);
    this.penguinBody.add(beak);

    // Waving Flippers
    this.leftFlipper = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 12), blackMat);
    this.leftFlipper.scale.set(0.45, 1.5, 0.7);
    this.leftFlipper.position.set(-0.98, 1.28, 0.1);
    this.leftFlipper.rotation.z = 0.45;
    this.penguinBody.add(this.leftFlipper);

    this.rightFlipper = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 12), blackMat);
    this.rightFlipper.scale.set(0.45, 1.5, 0.7);
    this.rightFlipper.position.set(0.98, 1.45, 0.15);
    this.rightFlipper.rotation.z = -0.85;
    this.penguinBody.add(this.rightFlipper);

    // Orange Webbed Feet
    for (const sx of [-1, 1]) {
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), orangeMat);
      foot.scale.set(1.1, 0.42, 1.45);
      foot.position.set(sx * 0.42, 0.12, 0.32);
      this.penguinBody.add(foot);
    }

    // Mini Watermelon Hat Crown on QQ Penguin
    const hatMelon = this.createBespokeFruitMesh(10, 0.38);
    hatMelon.position.set(0, 2.52, 0);
    this.penguinBody.add(hatMelon);

    // 3D Next-Fruit Tray/Flipper Slot held by the QQ Penguin (pre-cached 0..4 meshes for 0 allocation per drop)
    this.penguinHeldSlot = new THREE.Group();
    this.penguinHeldSlot.position.set(0.62, 1.42, 0.86);
    this.penguinBody.add(this.penguinHeldSlot);
    this.penguinNextMeshes = [];
    for (let t = 0; t <= 5; t++) {
      const m = this.createBespokeFruitMesh(t, 0.34);
      m.visible = t === 0;
      this.penguinHeldSlot.add(m);
      this.penguinNextMeshes.push(m);
    }
    this.penguinNextTier = 0;
  }

  _buildEvolutionRing() {
    // 3D 11-Tier Fruit Evolution Ring on the right side of the jar (clear of jar pillar)
    this.evolutionGroup = new THREE.Group();
    this.evolutionGroup.position.set(7.55, 5.2, -0.2);
    this.evolutionGroup.rotation.y = -0.22;
    this.rootGroup.add(this.evolutionGroup);

    const ringRadius = 1.92;
    const ringBacking = new THREE.Mesh(
      new THREE.TorusGeometry(ringRadius, 0.09, 14, 48),
      new THREE.MeshStandardMaterial({
        color: 0xfbbf24,
        roughness: 0.25,
        metalness: 0.18,
      })
    );
    this.evolutionGroup.add(ringBacking);

    this.evolutionRingItems = [];
    const total = FRUIT_TIERS.length;
    for (let t = 0; t < total; t++) {
      const angle = Math.PI * 0.5 - (t / total) * Math.PI * 2;
      const itemGroup = new THREE.Group();
      itemGroup.position.set(
        Math.cos(angle) * ringRadius,
        Math.sin(angle) * ringRadius,
        0.12
      );

      const halo = new THREE.Mesh(
        new THREE.RingGeometry(0.28, 0.38, 20),
        new THREE.MeshBasicMaterial({
          color: 0xfde047,
          transparent: true,
          opacity: 0.35,
          side: THREE.DoubleSide,
        })
      );
      itemGroup.add(halo);

      const displayRadius = 0.19 + (t / total) * 0.12;
      const miniFruit = this.createBespokeFruitMesh(t, displayRadius);
      itemGroup.add(miniFruit);

      this.evolutionGroup.add(itemGroup);
      this.evolutionRingItems.push({ tier: t, group: itemGroup, halo, miniFruit });
    }
  }

  _buildPodium3D() {
    // 3D Top-3 Star Podium shown when status === 'podium'
    this.podiumGroup.position.set(0, 2.2, 4.2);

    const podiumConfigs = [
      { rank: 1, x: 0, h: 2.4, color: 0xfbbf24 }, // 1st Gold Center
      { rank: 2, x: -2.35, h: 1.75, color: 0xe2e8f0 }, // 2nd Silver Left
      { rank: 3, x: 2.35, h: 1.35, color: 0xf59e0b }, // 3rd Bronze Right
    ];

    for (const pc of podiumConfigs) {
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(0.95, 1.08, pc.h, 24),
        new THREE.MeshStandardMaterial({
          color: pc.color,
          roughness: 0.25,
          metalness: 0.18,
        })
      );
      col.position.set(pc.x, pc.h * 0.5, 0);
      this.podiumGroup.add(col);
    }

    // Giant Trophy Big Watermelon on 1st pedestal
    this.podiumTrophy = this.createBespokeFruitMesh(10, 0.95);
    this.podiumTrophy.position.set(0, 3.45, 0.2);
    this.podiumGroup.add(this.podiumTrophy);

    // 3 Spinning 3D Stars above the podium
    this.podiumStars = [];
    const starMatOn = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      emissive: 0xeab308,
      emissiveIntensity: 0.45,
      roughness: 0.2,
      metalness: 0.18,
    });
    const starMatOff = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      roughness: 0.5,
      metalness: 0.1,
    });
    for (let i = 0; i < 3; i++) {
      const starGroup = new THREE.Group();
      starGroup.position.set((i - 1) * 1.45, 4.85 + (i === 1 ? 0.35 : 0), 0.4);
      const oct = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), starMatOn);
      oct.scale.set(1.1, 1.1, 0.45);
      starGroup.add(oct);
      this.podiumGroup.add(starGroup);
      this.podiumStars.push({ group: starGroup, mesh: oct, starMatOn, starMatOff });
    }
  }

  /**
   * Builds a bespoke 3D Three.js mesh group for any of the 11 fruit tiers (0..10).
   * Guaranteed metalness <= 0.22, rich multi-part botanical geometry, and kawaii 3D face.
   * @param {number} tier
   * @param {number=} customRadius
   * @return {THREE.Group}
   */
  createBespokeFruitMesh(tier, customRadius) {
    const spec = FRUIT_TIERS[tier] || FRUIT_TIERS[0];
    const r = typeof customRadius === 'number' ? customRadius : spec.radius;
    const group = new THREE.Group();
    group.userData = { tier, baseRadius: r };

    const mainMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(spec.color),
      roughness: 0.26,
      metalness: 0.1,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(spec.accentColor),
      roughness: 0.3,
      metalness: 0.08,
    });
    const stemMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(spec.stemColor),
      roughness: 0.38,
      metalness: 0.08,
    });
    const leafMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(spec.leafColor),
      roughness: 0.28,
      metalness: 0.08,
    });

    // Tier-specific bespoke 3D silhouette & botanical details
    switch (tier) {
      case 0: {
        // 0: Grape (葡萄) — Plump cluster of 3D grape berries + stem + leaf
        const core = new THREE.Mesh(new THREE.SphereGeometry(r * 0.88, 22, 18), mainMat);
        group.add(core);
        const berryOffsets = [
          [-0.42, 0.35, -0.15],
          [0.42, 0.35, -0.15],
          [0, 0.52, -0.1],
          [-0.48, -0.22, -0.12],
          [0.48, -0.22, -0.12],
          [0, -0.48, -0.15],
        ];
        for (const [bx, by, bz] of berryOffsets) {
          const berry = new THREE.Mesh(
            new THREE.SphereGeometry(r * 0.44, 14, 12),
            bx + by > 0 ? mainMat : accentMat
          );
          berry.position.set(bx * r, by * r, bz * r);
          group.add(berry);
        }
        this._addStemAndLeaf(group, r, stemMat, leafMat, 1);
        break;
      }

      case 1: {
        // 1: Cherry (樱桃) — Twin-lobed ruby heart cherry + tall curved stem
        for (const sx of [-0.18, 0.18]) {
          const lobe = new THREE.Mesh(new THREE.SphereGeometry(r * 0.88, 22, 18), mainMat);
          lobe.scale.set(0.92, 0.98, 0.94);
          lobe.position.set(sx * r, -0.04 * r, 0);
          group.add(lobe);
        }
        const archStem = new THREE.Mesh(
          new THREE.CylinderGeometry(r * 0.06, r * 0.08, r * 0.95, 10),
          stemMat
        );
        archStem.position.set(r * 0.12, r * 1.15, 0);
        archStem.rotation.z = -0.28;
        group.add(archStem);
        this._addStemAndLeaf(group, r * 1.15, stemMat, leafMat, 1);
        break;
      }

      case 2: {
        // 2: Mandarin (橘子) — Oblate tangerine with 3D dimple bumps + star calyx
        const body = new THREE.Mesh(new THREE.SphereGeometry(r, 26, 20), mainMat);
        body.scale.set(1.03, 0.9, 0.98);
        group.add(body);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const bump = new THREE.Mesh(new THREE.SphereGeometry(r * 0.12, 8, 8), accentMat);
          bump.position.set(Math.cos(a) * r * 0.88, (i % 2 === 0 ? 0.2 : -0.2) * r, Math.sin(a) * r * 0.85);
          group.add(bump);
        }
        this._addStarCalyx(group, r * 0.88, leafMat, 5);
        this._addStemAndLeaf(group, r * 0.9, stemMat, leafMat, 1);
        break;
      }

      case 3: {
        // 3: Lemon (柠檬) — Sunny yellow citrus with twin pointed apical mamilla nubs
        const body = new THREE.Mesh(new THREE.SphereGeometry(r * 0.96, 26, 20), mainMat);
        body.scale.set(1.06, 0.92, 0.94);
        group.add(body);
        for (const sx of [-1, 1]) {
          const nub = new THREE.Mesh(new THREE.ConeGeometry(r * 0.32, r * 0.38, 14), accentMat);
          nub.rotation.z = -sx * Math.PI * 0.5;
          nub.position.set(sx * r * 0.95, 0, 0);
          group.add(nub);
        }
        this._addStemAndLeaf(group, r * 0.92, stemMat, leafMat, 1);
        break;
      }

      case 4: {
        // 4: Kiwi (猕猴桃) — Warm brown hull + emerald green top window + black seeds
        const hull = new THREE.Mesh(new THREE.SphereGeometry(r, 26, 20), mainMat);
        group.add(hull);
        const greenSlice = new THREE.Mesh(
          new THREE.CylinderGeometry(r * 0.72, r * 0.82, r * 0.28, 22),
          accentMat
        );
        greenSlice.position.y = r * 0.72;
        group.add(greenSlice);

        const seedMat = new THREE.MeshBasicMaterial({ color: 0x1e293b });
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const seed = new THREE.Mesh(new THREE.SphereGeometry(r * 0.055, 8, 8), seedMat);
          seed.position.set(Math.cos(a) * r * 0.45, r * 0.87, Math.sin(a) * r * 0.45);
          group.add(seed);
        }
        break;
      }

      case 5: {
        // 5: Tomato (西红柿) — Ribbed crimson lobes + 6-point green star sepal crown
        const core = new THREE.Mesh(new THREE.SphereGeometry(r * 0.97, 26, 20), mainMat);
        core.scale.set(1.03, 0.92, 1.0);
        group.add(core);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const lobe = new THREE.Mesh(new THREE.SphereGeometry(r * 0.56, 16, 14), mainMat);
          lobe.position.set(Math.cos(a) * r * 0.42, 0, Math.sin(a) * r * 0.42);
          group.add(lobe);
        }
        this._addStarCalyx(group, r * 0.92, leafMat, 6);
        this._addStemAndLeaf(group, r * 0.92, stemMat, leafMat, 1);
        break;
      }

      case 6: {
        // 6: Peach (水蜜桃) — Blushing pink heart-cleft peach + pointed tip + twin leaves
        const body = new THREE.Mesh(new THREE.SphereGeometry(r * 0.96, 28, 22), mainMat);
        group.add(body);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(r * 0.52, r * 0.48, 18), accentMat);
        tip.position.y = r * 0.85;
        group.add(tip);
        this._addStemAndLeaf(group, r * 0.92, stemMat, leafMat, 2);
        break;
      }

      case 7: {
        // 7: Pineapple (菠萝) — Golden diamond-studded body + tall spiky leaf crown
        const body = new THREE.Mesh(new THREE.SphereGeometry(r * 0.95, 28, 22), mainMat);
        body.scale.set(0.96, 1.04, 0.96);
        group.add(body);
        for (let ring = -1; ring <= 1; ring++) {
          const count = 8;
          for (let i = 0; i < count; i++) {
            const a = ((i + ring * 0.5) / count) * Math.PI * 2;
            // Skip front face area so kawaii eyes stay clean
            if (Math.sin(a) > 0.55 && ring === 0) continue;
            const stud = new THREE.Mesh(
              new THREE.OctahedronGeometry(r * 0.14, 0),
              accentMat
            );
            const ry = ring * r * 0.42;
            const rr = Math.sqrt(Math.max(0.1, r * r * 0.86 - ry * ry));
            stud.position.set(Math.cos(a) * rr, ry, Math.sin(a) * rr);
            group.add(stud);
          }
        }
        // Spiky multi-blade green crown
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const blade = new THREE.Mesh(
            new THREE.ConeGeometry(r * 0.2, r * 0.68, 10),
            leafMat
          );
          blade.position.set(Math.cos(a) * r * 0.22, r * 1.12, Math.sin(a) * r * 0.22);
          blade.rotation.z = -Math.cos(a) * 0.38;
          blade.rotation.x = Math.sin(a) * 0.38;
          group.add(blade);
        }
        break;
      }

      case 8: {
        // 8: Coconut (椰子) — Rich brown shell + white coconut meat crown + tropical straw
        const shell = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 22), mainMat);
        group.add(shell);
        const whiteCap = new THREE.Mesh(
          new THREE.CylinderGeometry(r * 0.62, r * 0.72, r * 0.24, 24),
          accentMat
        );
        whiteCap.position.y = r * 0.76;
        group.add(whiteCap);
        // Tropical blue straw
        const straw = new THREE.Mesh(
          new THREE.CylinderGeometry(r * 0.07, r * 0.07, r * 0.65, 12),
          leafMat
        );
        straw.position.set(r * 0.28, r * 1.05, 0);
        straw.rotation.z = -0.35;
        group.add(straw);
        break;
      }

      case 9: {
        // 9: Half-Melon (半个西瓜) — Green outer rind dome + white inner rind ring + juicy red cut face + black seeds!
        const rind = new THREE.Mesh(new THREE.SphereGeometry(r, 30, 24), accentMat);
        rind.scale.set(1.0, 1.0, 0.72);
        rind.position.z = -r * 0.12;
        group.add(rind);

        const whiteRim = new THREE.Mesh(
          new THREE.CylinderGeometry(r * 0.92, r * 0.95, r * 0.22, 30),
          stemMat
        );
        whiteRim.rotation.x = Math.PI * 0.5;
        whiteRim.position.z = r * 0.52;
        group.add(whiteRim);

        const redFlesh = new THREE.Mesh(
          new THREE.CylinderGeometry(r * 0.82, r * 0.84, r * 0.25, 30),
          mainMat
        );
        redFlesh.rotation.x = Math.PI * 0.5;
        redFlesh.position.z = r * 0.56;
        group.add(redFlesh);

        const seedMat = new THREE.MeshBasicMaterial({ color: 0x0f172a });
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          const seed = new THREE.Mesh(new THREE.SphereGeometry(r * 0.065, 8, 8), seedMat);
          seed.scale.set(0.75, 1.35, 0.55);
          seed.position.set(
            Math.cos(a) * r * 0.60,
            Math.sin(a) * r * 0.60,
            r * 0.69
          );
          seed.rotation.z = a + Math.PI * 0.5;
          group.add(seed);
        }
        break;
      }

      case 10:
      default: {
        // 10: Big Watermelon (大西瓜) — Glossy emerald melon + dark-green meridian stripes + curly vine + Golden Crown!
        const melon = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 26), mainMat);
        group.add(melon);

        const stripeCount = 6;
        for (let i = 0; i < stripeCount; i++) {
          const stripe = new THREE.Mesh(
            new THREE.TorusGeometry(r * 0.985, r * 0.065, 10, 36),
            accentMat
          );
          stripe.rotation.y = (i / stripeCount) * Math.PI;
          group.add(stripe);
        }

        // Golden Crown atop the Big Watermelon
        const crownBase = new THREE.Mesh(
          new THREE.CylinderGeometry(r * 0.38, r * 0.3, r * 0.24, 16),
          stemMat
        );
        crownBase.position.y = r * 1.02;
        group.add(crownBase);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          const spike = new THREE.Mesh(
            new THREE.ConeGeometry(r * 0.09, r * 0.22, 8),
            stemMat
          );
          spike.position.set(
            Math.cos(a) * r * 0.3,
            r * 1.2,
            Math.sin(a) * r * 0.3
          );
          group.add(spike);
        }
        break;
      }
    }

    // Add cute glossy 3D kawaii face on the front (+Z) of every fruit
    this._addKawaiiFace(group, r);
    return group;
  }

  _addStemAndLeaf(group, r, stemMat, leafMat, leafCount = 1) {
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.07, r * 0.1, r * 0.28, 10),
      stemMat
    );
    stem.position.y = r * 0.98;
    group.add(stem);

    for (let i = 0; i < leafCount; i++) {
      const dir = i === 0 ? 1 : -1;
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(r * 0.22, 12, 10), leafMat);
      leaf.scale.set(1.45, 0.38, 0.75);
      leaf.position.set(dir * r * 0.24, r * 1.04, 0.04 * r);
      leaf.rotation.z = -dir * 0.35;
      group.add(leaf);
    }
  }

  _addStarCalyx(group, yOffset, leafMat, points = 5) {
    for (let i = 0; i < points; i++) {
      const a = (i / points) * Math.PI * 2;
      const sepal = new THREE.Mesh(
        new THREE.ConeGeometry(yOffset * 0.12, yOffset * 0.34, 8),
        leafMat
      );
      sepal.position.set(
        Math.cos(a) * yOffset * 0.2,
        yOffset,
        Math.sin(a) * yOffset * 0.2
      );
      sepal.rotation.x = Math.PI * 0.42;
      sepal.rotation.z = a;
      group.add(sepal);
    }
  }

  _addKawaiiFace(group, r) {
    const faceGroup = new THREE.Group();
    faceGroup.position.z = r * 0.88;

    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1e1b4b });
    const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const blushMat = new THREE.MeshBasicMaterial({
      color: 0xfb7185,
      transparent: true,
      opacity: 0.78,
    });

    const eyeSize = Math.max(0.055, r * 0.115);
    const eyeSpread = r * 0.32;

    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(eyeSize, 12, 10), eyeMat);
      eye.scale.set(1.0, 1.15, 0.45);
      eye.position.set(sx * eyeSpread, r * 0.08, 0.04 * r);
      faceGroup.add(eye);

      const glint = new THREE.Mesh(
        new THREE.SphereGeometry(eyeSize * 0.38, 8, 8),
        glintMat
      );
      glint.position.set(
        sx * eyeSpread - eyeSize * 0.22,
        r * 0.08 + eyeSize * 0.28,
        0.08 * r
      );
      faceGroup.add(glint);

      const blush = new THREE.Mesh(
        new THREE.SphereGeometry(eyeSize * 0.85, 10, 8),
        blushMat
      );
      blush.scale.set(1.3, 0.65, 0.3);
      blush.position.set(sx * (eyeSpread + eyeSize * 1.1), -r * 0.06, 0.02 * r);
      faceGroup.add(blush);
    }

    const smile = new THREE.Mesh(
      new THREE.TorusGeometry(Math.max(0.06, r * 0.13), Math.max(0.018, r * 0.032), 8, 16, Math.PI),
      eyeMat
    );
    smile.rotation.z = Math.PI;
    smile.position.set(0, -r * 0.04, 0.04 * r);
    faceGroup.add(smile);

    group.add(faceGroup);
  }

  /**
   * Adapts WebGL viewport and camera framing across landscape and portrait screens:
   * - Landscape (1280x800, 1024x768, 844x390): jar interior height = ~89-90% of viewport height,
   *   grape diameter >= 58 px at 1280x800, jar 100% visible, zero HUD overlap.
   * - Portrait (390x844): jar 100% visible horizontally and framed cleanly between top HUD and bottom tool dock.
   */
  resize() {
    const w = Math.max(1, window.innerWidth || 1280);
    const h = Math.max(1, window.innerHeight || 800);
    this.camera.aspect = w / h;

    if (w < h) {
      // Portrait (e.g. 390x844 mobile/tablet portrait)
      this.camera.fov = 34;
      const targetHorizSpan = 7.45;
      const vSpan = Math.max(14.8, targetHorizSpan / Math.max(0.25, w / h));
      const halfFovRad = THREE.MathUtils.degToRad(this.camera.fov * 0.5);
      const camZ = vSpan / (2 * Math.tan(halfFovRad));
      this.camera.position.set(0, 4.72, camZ);
      this.cameraTarget.set(0, 4.72, 0);
      if (this.penguinGroup) {
        this.penguinGroup.position.set(-2.35, 9.65, -0.4);
        this.penguinGroup.scale.setScalar(0.52);
      }
      if (this.evolutionGroup) {
        this.evolutionGroup.visible = false;
      }
    } else {
      // Landscape (1280x800, 1024x768, 844x390): frame [floorY - 0.3, spawnY + 0.96 + 0.3] into viewport
      this.camera.fov = 34;
      const yMin = JAR_CONFIG.floorY - 0.3;
      const yMax = JAR_CONFIG.spawnY + 0.96 + 0.3;
      const vSpan = yMax - yMin;
      const centerY = (yMin + yMax) * 0.5;
      const halfFovRad = THREE.MathUtils.degToRad(this.camera.fov * 0.5);
      const camZ = vSpan / (2 * Math.tan(halfFovRad));
      this.camera.position.set(0, centerY, camZ);
      this.cameraTarget.set(0, centerY, 0);
      if (this.penguinGroup) {
        this.penguinGroup.position.set(-4.88, 0.1, 0.25);
        this.penguinGroup.scale.setScalar(0.85);
      }
      if (this.evolutionGroup) {
        if (h <= 440) {
          this.evolutionGroup.visible = false;
        } else {
          this.evolutionGroup.visible = true;
          this.evolutionGroup.position.set(5.48, 5.55, -0.1);
          this.evolutionGroup.scale.setScalar(0.54);
        }
      }
    }

    this.camera.lookAt(this.cameraTarget);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();

    if (this.renderer) {
      this.renderer.setSize(w, h, false);
    }
    this._cachedW = w;
    this._cachedH = h;
    this._cachedJarRect = this._computeJarScreenRect();
    this._cachedGrapePx = this._computeGrapePixelDiameter();
  }

  /**
   * Projects a 3D world coordinate (worldX, worldY, worldZ) into screen pixels.
   * @param {number} worldX
   * @param {number} worldY
   * @param {number=} worldZ
   * @return {{x: number, y: number}}
   */
  worldToScreen(worldX, worldY, worldZ = 0) {
    const w = Math.max(1, window.innerWidth || this.canvas.clientWidth || 1280);
    const h = Math.max(1, window.innerHeight || this.canvas.clientHeight || 800);
    const v = new THREE.Vector3(worldX, worldY, worldZ);
    v.project(this.camera);
    return {
      x: (v.x * 0.5 + 0.5) * w,
      y: (-v.y * 0.5 + 0.5) * h,
    };
  }

  _computeJarScreenRect() {
    const w = Math.max(1, window.innerWidth || 1280);
    const h = Math.max(1, window.innerHeight || 800);
    const topLeft = this.worldToScreen(-JAR_CONFIG.halfWidth, JAR_CONFIG.rimY, 0);
    const bottomRight = this.worldToScreen(JAR_CONFIG.halfWidth, JAR_CONFIG.floorY, 0);
    const outerLeft = this.worldToScreen(-(JAR_CONFIG.halfWidth + JAR_CONFIG.wallThickness + 0.15), JAR_CONFIG.rimY * 0.5, 0);
    const outerRight = this.worldToScreen(JAR_CONFIG.halfWidth + JAR_CONFIG.wallThickness + 0.15, JAR_CONFIG.rimY * 0.5, 0);
    const heldTop = this.worldToScreen(0, JAR_CONFIG.spawnY + 0.96, 0);
    const evoLeft = this.worldToScreen(5.48 - 2.30 * 0.54, 5.55, -0.1);
    const left = Math.min(topLeft.x, bottomRight.x);
    const right = Math.max(topLeft.x, bottomRight.x);
    const top = Math.min(topLeft.y, bottomRight.y);
    const bottom = Math.max(topLeft.y, bottomRight.y);
    const width = right - left;
    const height = bottom - top;
    return {
      left: Number(left.toFixed(2)),
      top: Number(top.toFixed(2)),
      right: Number(right.toFixed(2)),
      bottom: Number(bottom.toFixed(2)),
      width: Number(width.toFixed(2)),
      height: Number(height.toFixed(2)),
      interiorHeightRatio: Number((height / h).toFixed(4)),
      heldFruitTopPx: Number(heldTop.y.toFixed(2)),
      jarFloorBottomMarginPx: Number((h - bottom).toFixed(2)),
      jarOuterRightPx: Number(outerRight.x.toFixed(2)),
      evolutionWheelVisible: Boolean(this.evolutionGroup && this.evolutionGroup.visible),
      evolutionWheelLeftPx: Number(evoLeft.x.toFixed(2)),
      fullyVisible:
        outerLeft.x >= 0 &&
        outerRight.x <= w &&
        top >= 0 &&
        bottom <= h,
    };
  }

  /**
   * Returns the projected screen bounding box of the 3D jar interior (x = -halfWidth..+halfWidth, y = floorY..rimY).
   * @return {Object}
   */
  getJarScreenRect() {
    if (this._cachedW !== window.innerWidth || this._cachedH !== window.innerHeight) {
      this.resize();
    }
    return this._cachedJarRect || (this._cachedJarRect = this._computeJarScreenRect());
  }

  _computeGrapePixelDiameter() {
    const r = FRUIT_TIERS[0].radius;
    const pTop = this.worldToScreen(0, 4.5 + r, 0);
    const pBottom = this.worldToScreen(0, 4.5 - r, 0);
    return Number(Math.abs(pBottom.y - pTop.y).toFixed(2));
  }

  /**
   * Computes the rendered pixel diameter of a Tier-0 Grape at the center of the jar.
   * @return {number}
   */
  getGrapePixelDiameter() {
    if (this._cachedW !== window.innerWidth || this._cachedH !== window.innerHeight) {
      this.resize();
    }
    return this._cachedGrapePx || (this._cachedGrapePx = this._computeGrapePixelDiameter());
  }

  /**
   * Projects screen clientX/clientY onto the z=0 jar plane and raycasts 3D fruits.
   * @param {number} clientX
   * @param {number} clientY
   * @return {{worldX: number, worldY: number, hitFruitId: number|null}}
   */
  raycastJar(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    this.pointerNdc.x = ((clientX - rect.left) / w) * 2 - 1;
    this.pointerNdc.y = -((clientY - rect.top) / h) * 2 + 1;

    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const targetPoint = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.jarPlane, targetPoint);

    let hitFruitId = null;
    const fruitRoots = Array.from(this.fruitMeshes.values());
    if (fruitRoots.length > 0) {
      const hits = this.raycaster.intersectObjects(fruitRoots, true);
      for (const hit of hits) {
        let cur = hit.object;
        while (cur && cur !== this.fruitsGroup) {
          if (cur.userData && typeof cur.userData.fruitId === 'number') {
            hitFruitId = cur.userData.fruitId;
            break;
          }
          cur = cur.parent;
        }
        if (hitFruitId !== null) break;
      }
    }

    return {
      worldX: Number.isFinite(targetPoint.x) ? targetPoint.x : 0,
      worldY: Number.isFinite(targetPoint.y) ? targetPoint.y : 0,
      hitFruitId,
    };
  }

  /**
   * Synchronizes all 3D meshes, particles, dropper preview, and podium with state.
   * @param {Object} state
   * @param {number=} dt
   * @param {boolean=} drawWebGL
   */
  render(state, dt = 1 / 60, drawWebGL = true) {
    this.clockTime += dt;
    if (state.frame === 0 && this.processedEventFrame > 0) {
      this.processedEventFrame = -1;
    }

    // 1. Jar Shake & Tier-Scaled Screen Shake Animation
    const shakeAmp = Math.max(
      state.shakeTimer > 0 ? state.shakeTimer * 0.25 : 0,
      state.screenShake > 0 ? state.screenShake : 0
    );
    if (shakeAmp > 0) {
      this.jarGroup.position.x = Math.sin(this.clockTime * 55) * shakeAmp;
      this.jarGroup.position.y = Math.cos(this.clockTime * 62) * shakeAmp * 0.55;
      this.jarGroup.rotation.z = Math.cos(this.clockTime * 48) * shakeAmp * 0.12;
    } else {
      this.jarGroup.position.x = 0;
      this.jarGroup.position.y = 0;
      this.jarGroup.rotation.z = 0;
    }

    // 2. Sync Active Fruits in Jar
    const activeIds = new Set();
    for (const f of state.fruits) {
      activeIds.add(f.id);
      let mesh = this.fruitMeshes.get(f.id);
      if (!mesh || mesh.userData.tier !== f.tier) {
        if (mesh) {
          this.fruitsGroup.remove(mesh);
        }
        mesh = this.createBespokeFruitMesh(f.tier, f.radius);
        mesh.userData.fruitId = f.id;
        mesh.userData.tier = f.tier;
        this.fruitsGroup.add(mesh);
        this.fruitMeshes.set(f.id, mesh);
      }

      mesh.position.set(f.x, f.y, f.z);
      mesh.rotation.z = f.angle;

      // Merge squash/stretch (1.25 / 0.80 over 180 ms)
      let sx = f.spawnScale || 1.0;
      let sy = f.spawnScale || 1.0;
      if (f.wobbleTimer > 0) {
        const dur = JAR_CONFIG.mergeSquashDurationSec || 0.18;
        const p = Math.min(1, Math.max(0, f.wobbleTimer / dur));
        const osc = Math.cos((1 - p) * Math.PI * 2.5) * p;
        sx *= 1 + (JAR_CONFIG.mergeSquashX - 1) * osc;
        sy *= 1 + (JAR_CONFIG.mergeStretchY - 1) * osc;
      }
      if (state.activeTool === 'hammer') {
        const pulse = 1 + Math.sin(this.clockTime * 10 + f.id) * 0.04;
        sx *= pulse;
        sy *= pulse;
      }
      mesh.scale.set(sx, sy, f.spawnScale || 1.0);
    }

    for (const [id, mesh] of this.fruitMeshes.entries()) {
      if (!activeIds.has(id)) {
        this.fruitsGroup.remove(mesh);
        this.fruitMeshes.delete(id);
      }
    }

    // 3. Sync Dropper Claw, Held Fruit & Laser Guide Line
    // Hide dropper and jar fruits when on the 3D Podium so nothing peeks behind the podium banner card!
    const isPodium = state.status === 'podium' || state.uiScreen === 'podium';
    this.jarGroup.visible = !isPodium;

    const showDropper =
      !isPodium &&
      state.status === 'playing' &&
      state.uiScreen !== 'podium' &&
      Boolean(state.currentFruit);
    this.dropperGroup.visible = showDropper;
    this.laserLine.visible = showDropper;
    this.landingRing.visible = showDropper;

    if (showDropper && state.currentFruit) {
      const visualDropperY = JAR_CONFIG.spawnY;
      this.dropperGroup.position.set(state.aimX, visualDropperY, 0);
      const curR = state.currentFruit.radius || 0.5;
      if (this.clawCap) {
        this.clawCap.position.y = curR + 0.12;
      }
      if (this.cloudPuffs) {
        for (const cp of this.cloudPuffs) {
          cp.mesh.position.y = curR + 0.26 + (cp.ox === 0 ? 0.04 : 0);
        }
      }
      if (this.heldFruitTier !== state.currentFruit.tier) {
        if (this.heldFruitGroup) {
          this.dropperGroup.remove(this.heldFruitGroup);
        }
        this.heldFruitGroup = this.createBespokeFruitMesh(
          state.currentFruit.tier,
          state.currentFruit.radius
        );
        this.dropperGroup.add(this.heldFruitGroup);
        this.heldFruitTier = state.currentFruit.tier;
      }

      const dropY = state.projectedDropY ?? JAR_CONFIG.floorY + state.currentFruit.radius;
      const beamLen = Math.max(0.2, visualDropperY - dropY);
      this.laserLine.scale.set(1, beamLen, 1);
      this.laserLine.position.set(state.aimX, dropY + beamLen * 0.5, -0.08);

      this.landingRing.position.set(state.aimX, dropY, 0.25);
      const rScale = state.currentFruit.radius;
      this.landingRing.scale.setScalar(rScale);
    }

    // 4. Warning Rim Pulse & Near-Rim Danger Glow
    if (this.warningDashMat) {
      const danger = Boolean(state.nearRimDanger) || state.maxOverflowTimer > 0.05;
      const pulse = Math.sin(this.clockTime * 16) * 0.5 + 0.5;
      this.warningDashMat.emissiveIntensity = danger ? 0.55 + pulse * 0.65 : 0.28;
      if (this.warningRimGroup) {
        this.warningRimGroup.scale.y = danger ? 1 + pulse * 0.45 : 1.0;
      }
      if (this.rimGlowMat) {
        const prox = Math.max(state.dangerProximity || 0, state.maxOverflowTimer > 0 ? 1 : 0);
        this.rimGlowMat.opacity = danger ? (0.24 + pulse * 0.48) * Math.max(0.4, prox) : 0.0;
      }
    }

    // 5. Process New Simulation Events for 3D Juice Particles & Hammer Swing FX
    this._consumeSimEvents(state);
    this._stepVisualEffects(dt);

    // 6. Sync 3D Next-Fruit Held by QQ Penguin + Animate Bounce/Cheer & Evolution Ring
    if (this.penguinNextMeshes && typeof state.nextFruitTier === 'number') {
      const targetTier = Math.min(this.penguinNextMeshes.length - 1, Math.max(0, state.nextFruitTier));
      if (this.penguinNextTier !== targetTier) {
        for (let i = 0; i < this.penguinNextMeshes.length; i++) {
          this.penguinNextMeshes[i].visible = i === targetTier;
        }
        this.penguinNextTier = targetTier;
      }
      const activeHeld = this.penguinNextMeshes[this.penguinNextTier];
      if (activeHeld) {
        activeHeld.rotation.y = this.clockTime * 1.8;
      }
    }

    if (this.penguinBody) {
      if (this.cheerTimer > 0) {
        this.cheerTimer = Math.max(0, this.cheerTimer - dt);
        this.penguinBody.position.y = 0.36 + Math.abs(Math.sin(this.clockTime * 18)) * 0.58;
        this.rightFlipper.rotation.z = -1.35 + Math.sin(this.clockTime * 24) * 0.52;
        this.leftFlipper.rotation.z = 1.35 - Math.sin(this.clockTime * 24) * 0.52;
      } else if (this.penguinBounceTimer > 0) {
        this.penguinBounceTimer = Math.max(0, this.penguinBounceTimer - dt);
        const bounce = Math.sin((1 - this.penguinBounceTimer / 0.42) * Math.PI);
        this.penguinBody.position.y = 0.36 + bounce * 0.34;
        this.rightFlipper.rotation.z = -0.95 - bounce * 0.35;
        this.leftFlipper.rotation.z = 0.65 + bounce * 0.35;
      } else {
        this.penguinBody.position.y = 0.36 + Math.sin(this.clockTime * 3.2) * 0.06;
        this.rightFlipper.rotation.z = -0.75 + Math.sin(this.clockTime * 4.5) * 0.18;
        this.leftFlipper.rotation.z = 0.45 - Math.sin(this.clockTime * 4.5) * 0.12;
      }
    }

    for (const item of this.evolutionRingItems) {
      const unlocked = item.tier <= state.highestTier;
      const isHighlighted =
        item.tier === state.highlightedTier && (state.highlightTimer || 0) > 0;
      if (isHighlighted) {
        const pulse = 1.42 + Math.sin(this.clockTime * 24) * 0.14;
        item.group.scale.setScalar(pulse);
        item.halo.material.opacity = 1.0;
        item.halo.material.color.setHex(0xffffff);
      } else {
        item.group.scale.setScalar(1.0);
        item.halo.material.opacity = unlocked ? 0.82 : 0.18;
        item.halo.material.color.setHex(
          item.tier === state.highestTier ? 0x4ade80 : 0xfde047
        );
      }
      item.miniFruit.rotation.y = Math.sin(this.clockTime * 2 + item.tier * 0.5) * 0.28;
    }

    // 7. 3D Podium Visibility & Star Animation
    this.podiumGroup.visible = state.status === 'podium';
    if (this.podiumGroup.visible) {
      if (this.podiumTrophy) {
        this.podiumTrophy.rotation.y = this.clockTime * 1.4;
      }
      for (let i = 0; i < this.podiumStars.length; i++) {
        const st = this.podiumStars[i];
        const earned = i < state.stars;
        st.mesh.material = earned ? st.starMatOn : st.starMatOff;
        st.group.rotation.y = this.clockTime * 2.2 + i * 0.8;
      }
    }

    if (drawWebGL && this.renderer) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  _consumeSimEvents(state) {
    const events = state.recentEvents || [];
    for (const ev of events) {
      if (ev.frame < this.processedEventFrame) continue;
      if (ev.frame === this.processedEventFrame && ev.type !== 'merge' && ev.type !== 'tool_hammer_smash') {
        continue;
      }
      if (ev.type === 'merge') {
        const spec = FRUIT_TIERS[ev.toTier] || FRUIT_TIERS[0];
        this._spawnJuiceBurst(
          ev.x,
          ev.y,
          spec.juiceColor,
          JAR_CONFIG.mergeJuiceParticles || 14
        );
        this._spawnShockwaveRing(ev.x, ev.y, spec.radius, spec.color);
        this.penguinBounceTimer = 0.42;
        if (ev.toTier >= 7) {
          this.cheerTimer = 1.25;
        }
      } else if (ev.type === 'big_watermelon_celebration') {
        this._spawnConfettiBurst(ev.x, ev.y, 26);
        this._spawnJuiceBurst(ev.x, ev.y, '#facc15', 18);
        this._spawnShockwaveRing(ev.x, ev.y, 2.7, '#facc15');
        this.cheerTimer = 1.8;
      } else if (ev.type === 'golden_watermelon_fountain') {
        this._spawnConfettiBurst(ev.x, ev.y, 28);
        this._spawnJuiceBurst(ev.x, ev.y, '#facc15', 20);
        this._spawnShockwaveRing(ev.x, ev.y, 2.8, '#facc15');
        this.cheerTimer = 1.8;
      } else if (ev.type === 'tool_hammer_smash') {
        const spec = FRUIT_TIERS[ev.tier] || FRUIT_TIERS[0];
        this._spawnHammerSwing(ev.x, ev.y);
        this._spawnJuiceBurst(
          ev.x,
          ev.y,
          spec.juiceColor,
          JAR_CONFIG.mergeJuiceParticles || 14
        );
        this.penguinBounceTimer = 0.42;
      }
    }
    if (events.length > 0) {
      this.processedEventFrame = events[events.length - 1].frame + 1;
    }
  }

  _spawnConfettiBurst(x, y, count = 24) {
    const colors = ['#ef4444', '#facc15', '#22c55e', '#38bdf8', '#ec4899', '#a855f7'];
    if (!this.sharedConfettiGeo) {
      this.sharedConfettiGeo = new THREE.BoxGeometry(0.18, 0.28, 0.04);
    }
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= 64) {
        const oldest = this.particles.shift();
        this.fxGroup.remove(oldest.mesh);
      }
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(colors[i % colors.length]),
      });
      const piece = new THREE.Mesh(this.sharedConfettiGeo, mat);
      piece.position.set(x, y, 0.45);
      piece.rotation.set(i * 0.5, i * 0.8, i * 0.3);
      this.fxGroup.add(piece);
      const a = (i / count) * Math.PI * 2;
      const speed = 3.8 + (i % 5) * 1.5;
      this.particles.push({
        mesh: piece,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed + 4.8,
        vz: (i % 2 === 0 ? 1 : -1) * 1.5,
        life: 0.78,
        maxLife: 0.78,
      });
    }
  }

  _spawnJuiceBurst(x, y, hexColor, count = 10) {
    while (this.particles.length + count > 48 && this.particles.length > 0) {
      const oldest = this.particles.shift();
      this.fxGroup.remove(oldest.mesh);
    }
    if (!this.sharedDropGeo) {
      this.sharedDropGeo = new THREE.SphereGeometry(0.13, 8, 8);
    }
    const color = new THREE.Color(hexColor);
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.2,
      metalness: 0.08,
    });
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + (i % 3) * 0.2;
      const speed = 3.2 + (i % 5) * 1.4;
      const drop = new THREE.Mesh(this.sharedDropGeo, mat);
      drop.position.set(x, y, 0.35);
      this.fxGroup.add(drop);
      this.particles.push({
        mesh: drop,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed + 2.2,
        vz: (i % 2 === 0 ? 1 : -1) * 1.2,
        life: 0.55,
        maxLife: 0.55,
      });
    }
  }

  _spawnShockwaveRing(x, y, radius, hexColor) {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(hexColor),
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.98, 24), mat);
    ring.position.set(x, y, 0.3);
    this.fxGroup.add(ring);
    this.shockwaves.push({
      mesh: ring,
      startR: Math.max(0.4, radius * 0.6),
      endR: radius * 2.1,
      life: 0.38,
      maxLife: 0.38,
    });
  }

  _spawnHammerSwing(x, y) {
    const hammerGroup = new THREE.Group();
    hammerGroup.position.set(x + 0.8, y + 0.6, 0.9);
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.11, 1.3, 12),
      new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.35, metalness: 0.08 })
    );
    handle.position.y = 0.5;
    hammerGroup.add(handle);

    const head = new THREE.Mesh(
      new THREE.CylinderGeometry(0.36, 0.36, 0.85, 16),
      new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.25, metalness: 0.14 })
    );
    head.rotation.z = Math.PI * 0.5;
    head.position.y = 1.1;
    hammerGroup.add(head);

    this.fxGroup.add(hammerGroup);
    this.hammerAnims.push({ mesh: hammerGroup, life: 0.35, maxLife: 0.35 });
  }

  _stepVisualEffects(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.fxGroup.remove(p.mesh);
        this.particles.splice(i, 1);
        continue;
      }
      p.vy -= 18 * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.mesh.scale.setScalar(Math.max(0.05, p.life / p.maxLife));
    }

    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.life -= dt;
      if (sw.life <= 0) {
        this.fxGroup.remove(sw.mesh);
        this.shockwaves.splice(i, 1);
        continue;
      }
      const t = 1 - sw.life / sw.maxLife;
      const scale = sw.startR + (sw.endR - sw.startR) * t;
      sw.mesh.scale.setScalar(scale);
      sw.mesh.material.opacity = (1 - t) * 0.85;
    }

    for (let i = this.hammerAnims.length - 1; i >= 0; i--) {
      const h = this.hammerAnims[i];
      h.life -= dt;
      if (h.life <= 0) {
        this.fxGroup.remove(h.mesh);
        this.hammerAnims.splice(i, 1);
        continue;
      }
      const progress = 1 - h.life / h.maxLife;
      h.mesh.rotation.z = -0.6 + Math.sin(progress * Math.PI) * 1.4;
    }
  }
}
