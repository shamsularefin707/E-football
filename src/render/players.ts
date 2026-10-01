import * as THREE from 'three';
import type { Match } from '../sim/match';
import type { Kit, SimPlayer } from '../sim/types';

const SKIN = ['#f1d0b5', '#e2b48f', '#c68c62', '#a46b45', '#7a4b2e', '#4f3020'];
const HAIR = ['#1b1410', '#3a2618', '#6b4a2a', '#b88a4a', '#d9c08a', '#121212', '#5a1e10'];

type PartName =
  | 'torso'
  | 'hips'
  | 'head'
  | 'hair'
  | 'armL'
  | 'armR'
  | 'foreL'
  | 'foreR'
  | 'thighL'
  | 'thighR'
  | 'shinL'
  | 'shinR'
  | 'bootL'
  | 'bootR';

const PARTS: PartName[] = ['torso', 'hips', 'head', 'hair', 'armL', 'armR', 'foreL', 'foreR', 'thighL', 'thighR', 'shinL', 'shinR', 'bootL', 'bootR'];

function geometries(): Record<PartName, THREE.BufferGeometry> {
  const box = (w: number, h: number, d: number, ty: number, tz = 0) => new THREE.BoxGeometry(w, h, d).translate(0, ty, tz);
  const torso = new THREE.CylinderGeometry(0.23, 0.19, 0.58, 8, 1).translate(0, 0.29, 0);
  torso.scale(1, 1, 0.62);
  const hips = new THREE.CylinderGeometry(0.2, 0.21, 0.24, 8, 1).translate(0, -0.03, 0);
  hips.scale(1, 1, 0.7);
  const head = new THREE.IcosahedronGeometry(0.12, 1).translate(0, 0.13, 0.01);
  const hair = new THREE.SphereGeometry(0.128, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.5).translate(0, 0.15, -0.005);
  return {
    torso,
    hips,
    head,
    hair,
    armL: box(0.11, 0.3, 0.11, -0.15),
    armR: box(0.11, 0.3, 0.11, -0.15),
    foreL: box(0.09, 0.27, 0.09, -0.135),
    foreR: box(0.09, 0.27, 0.09, -0.135),
    thighL: box(0.15, 0.44, 0.15, -0.22),
    thighR: box(0.15, 0.44, 0.15, -0.22),
    shinL: box(0.12, 0.44, 0.12, -0.22),
    shinR: box(0.12, 0.44, 0.12, -0.22),
    bootL: box(0.11, 0.08, 0.25, -0.04, 0.06),
    bootR: box(0.11, 0.08, 0.25, -0.04, 0.06),
  };
}

interface Rig {
  root: THREE.Object3D;
  pelvis: THREE.Object3D;
  spine: THREE.Object3D;
  neck: THREE.Object3D;
  shL: THREE.Object3D;
  shR: THREE.Object3D;
  elL: THREE.Object3D;
  elR: THREE.Object3D;
  hipL: THREE.Object3D;
  hipR: THREE.Object3D;
  knL: THREE.Object3D;
  knR: THREE.Object3D;
  anL: THREE.Object3D;
  anR: THREE.Object3D;
  nodes: Record<PartName, THREE.Object3D>;
}

function makeRig(): Rig {
  const o = () => new THREE.Object3D();
  const root = o();
  const pelvis = o();
  pelvis.position.y = 0.95;
  root.add(pelvis);
  const spine = o();
  pelvis.add(spine);
  const neck = o();
  neck.position.y = 0.6;
  spine.add(neck);
  const shL = o();
  shL.position.set(0.27, 0.52, 0);
  const shR = o();
  shR.position.set(-0.27, 0.52, 0);
  spine.add(shL, shR);
  const elL = o();
  elL.position.y = -0.3;
  shL.add(elL);
  const elR = o();
  elR.position.y = -0.3;
  shR.add(elR);
  const hipL = o();
  hipL.position.set(0.11, -0.06, 0);
  const hipR = o();
  hipR.position.set(-0.11, -0.06, 0);
  pelvis.add(hipL, hipR);
  const knL = o();
  knL.position.y = -0.44;
  hipL.add(knL);
  const knR = o();
  knR.position.y = -0.44;
  hipR.add(knR);
  const anL = o();
  anL.position.y = -0.44;
  knL.add(anL);
  const anR = o();
  anR.position.y = -0.44;
  knR.add(anR);
  const nodes: Record<PartName, THREE.Object3D> = {
    torso: spine,
    hips: pelvis,
    head: neck,
    hair: neck,
    armL: shL,
    armR: shR,
    foreL: elL,
    foreR: elR,
    thighL: hipL,
    thighR: hipR,
    shinL: knL,
    shinR: knR,
    bootL: anL,
    bootR: anR,
  };
  return { root, pelvis, spine, neck, shL, shR, elL, elR, hipL, hipR, knL, knR, anL, anR, nodes };
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** All 22 players drawn with one instanced mesh per body part (14 draw calls total). */
export class PlayerMeshes {
  readonly group = new THREE.Group();
  private meshes = {} as Record<PartName, THREE.InstancedMesh>;
  private rig = makeRig();
  private phase = new Float32Array(22);
  private yaw = new Float32Array(22);
  private color = new THREE.Color();

  constructor(private m: Match) {
    const geo = geometries();
    for (const part of PARTS) {
      const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
      const mesh = new THREE.InstancedMesh(geo[part], mat, 22);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      this.meshes[part] = mesh;
      this.group.add(mesh);
    }
    for (const p of m.players) this.yaw[p.idx] = Math.atan2(p.facing.x, -p.facing.y);
    this.applyColors();
  }

  applyColors(): void {
    const teams = [this.m.cfg.home, this.m.cfg.away];
    for (const p of this.m.players) {
      const t = teams[p.team];
      const kit: Kit = p.slot === 0 ? t.gkKit : t.kit;
      const skin = SKIN[Math.floor(p.info.skin * SKIN.length) % SKIN.length];
      const hair = HAIR[Math.floor(p.info.hair * HAIR.length) % HAIR.length];
      const set = (part: PartName, c: string) => this.meshes[part].setColorAt(p.idx, this.color.set(c));
      set('torso', kit.shirt);
      set('armL', kit.shirt);
      set('armR', kit.shirt);
      set('hips', kit.shorts);
      set('thighL', kit.shorts);
      set('thighR', kit.shorts);
      set('shinL', kit.socks);
      set('shinR', kit.socks);
      set('foreL', p.slot === 0 ? kit.shirt : skin);
      set('foreR', p.slot === 0 ? kit.shirt : skin);
      set('head', skin);
      set('hair', hair);
      set('bootL', '#151515');
      set('bootR', '#151515');
    }
    for (const part of PARTS) if (this.meshes[part].instanceColor) this.meshes[part].instanceColor!.needsUpdate = true;
  }

  update(dt: number): void {
    const r = this.rig;
    for (const p of this.m.players) {
      this.pose(p, dt);
      r.root.updateMatrixWorld(true);
      for (const part of PARTS) this.meshes[part].setMatrixAt(p.idx, r.nodes[part].matrixWorld);
    }
    for (const part of PARTS) this.meshes[part].instanceMatrix.needsUpdate = true;
  }

  private pose(p: SimPlayer, dt: number): void {
    const r = this.rig;
    // Reset.
    for (const n of [r.pelvis, r.spine, r.neck, r.shL, r.shR, r.elL, r.elR, r.hipL, r.hipR, r.knL, r.knR, r.anL, r.anR]) n.rotation.set(0, 0, 0);
    r.pelvis.position.y = 0.95;
    if (p.sentOff) {
      r.root.position.set(0, -50, 0);
      return;
    }
    // Smoothly turn towards the facing direction.
    const targetYaw = Math.atan2(p.facing.x, -p.facing.y);
    let d = targetYaw - this.yaw[p.idx];
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw[p.idx] += d * Math.min(1, dt * 14);
    r.root.position.set(p.pos.x, 0, -p.pos.y);
    r.root.rotation.set(0, this.yaw[p.idx], 0);

    const speed = Math.hypot(p.vel.x, p.vel.y);
    this.phase[p.idx] += speed * dt * 3.3;
    const ph = this.phase[p.idx];
    const amp = Math.min(1, speed / 8.5);
    const s = Math.sin(ph);
    // Run cycle.
    r.hipL.rotation.x = -s * 0.85 * amp;
    r.hipR.rotation.x = s * 0.85 * amp;
    r.knL.rotation.x = Math.max(0, Math.sin(ph - 1.2)) * 1.3 * amp + 0.05;
    r.knR.rotation.x = Math.max(0, Math.sin(ph + Math.PI - 1.2)) * 1.3 * amp + 0.05;
    r.shL.rotation.x = s * 0.75 * amp;
    r.shR.rotation.x = -s * 0.75 * amp;
    r.shL.rotation.z = 0.12;
    r.shR.rotation.z = -0.12;
    r.elL.rotation.x = -0.4 - amp * 0.8;
    r.elR.rotation.x = -0.4 - amp * 0.8;
    r.spine.rotation.x = amp * 0.22;
    r.pelvis.position.y = 0.95 - amp * 0.04 + Math.abs(Math.cos(ph)) * 0.05 * amp;

    const owner = this.m.ball.owner === p.idx;
    if (p.slot === 0 && owner && this.m.ball.held) {
      r.shL.rotation.x = r.shR.rotation.x = -1.2;
      r.elL.rotation.x = r.elR.rotation.x = -0.5;
    } else if (p.slot === 0 && speed < 1) {
      // Keeper's ready stance.
      r.spine.rotation.x = 0.25;
      r.pelvis.position.y = 0.88;
      r.knL.rotation.x = r.knR.rotation.x = 0.4;
      r.hipL.rotation.x = r.hipR.rotation.x = -0.3;
      r.shL.rotation.z = 0.6;
      r.shR.rotation.z = -0.6;
    }

    switch (p.action) {
      case 'kick': {
        const k = smooth(Math.min(1, 1 - p.actionTime / 0.3));
        r.hipR.rotation.x = 0.7 - k * 2.0;
        r.knR.rotation.x = (1 - k) * 1.2;
        r.hipL.rotation.x = 0.1;
        r.shL.rotation.z = 0.7;
        r.shR.rotation.z = -0.5;
        r.spine.rotation.x = -0.1 + k * 0.15;
        break;
      }
      case 'throw': {
        const k = smooth(Math.min(1, 1 - p.actionTime / 0.3));
        r.shL.rotation.x = r.shR.rotation.x = -2.9 + k * 1.6;
        r.elL.rotation.x = r.elR.rotation.x = -0.6;
        r.spine.rotation.x = -0.2 + k * 0.4;
        break;
      }
      case 'tackle':
        r.hipR.rotation.x = -1.1;
        r.knR.rotation.x = 0.1;
        r.hipL.rotation.x = 0.4;
        r.knL.rotation.x = 0.8;
        r.spine.rotation.x = 0.35;
        r.pelvis.position.y = 0.8;
        break;
      case 'slide':
        r.pelvis.position.y = 0.32;
        r.pelvis.rotation.x = -1.15;
        r.hipR.rotation.x = -0.3;
        r.knR.rotation.x = 0;
        r.hipL.rotation.x = 0.2;
        r.knL.rotation.x = 1.2;
        r.shL.rotation.x = r.shR.rotation.x = 0.9;
        break;
      case 'stumble':
        r.spine.rotation.x = 0.7;
        r.pelvis.position.y = 0.82;
        r.shL.rotation.x = r.shR.rotation.x = -1.0;
        break;
      case 'dive': {
        // Roll towards the dive side relative to the keeper's facing.
        const fx = p.facing.x;
        const fy = p.facing.y;
        const side = Math.sign(fx * p.diveDir.y - fy * p.diveDir.x) || 1;
        r.pelvis.rotation.z = -side * 1.35;
        r.pelvis.position.y = 0.75;
        r.shL.rotation.z = 2.8;
        r.shR.rotation.z = -2.8;
        r.elL.rotation.x = r.elR.rotation.x = 0;
        break;
      }
      case 'celebrate':
        r.shL.rotation.z = 2.6;
        r.shR.rotation.z = -2.6;
        r.elL.rotation.x = r.elR.rotation.x = 0;
        r.spine.rotation.x = -0.15;
        break;
    }
  }
}
