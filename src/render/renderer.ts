import * as THREE from 'three';
import { BALL_RADIUS, GOAL_DEPTH, GOAL_HALF_WIDTH, GOAL_HEIGHT, PITCH_HALF_LENGTH, PITCH_HALF_WIDTH } from '../sim/constants';
import type { Match } from '../sim/match';
import { PlayerMeshes } from './players';
import { PITCH_MARGIN_X, PITCH_MARGIN_Y, makeBallTexture, makeBlobTexture, makeBoardTexture, makeCrowdTexture, makePitchTexture } from './textures';

export type Quality = 'low' | 'medium' | 'high';
export type CameraMode = 'broadcast' | 'close' | 'wide';

export interface RenderOptions {
  quality: Quality;
  night: boolean;
  camera: CameraMode;
}

export const CONTROLLER_COLORS = ['#3aa0ff', '#ff4d5e', '#ffd23a', '#3dff8a'];

/** Sim (x, y, z-up) to three.js (x, y-up, z towards the camera). */
const toThree = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private players: PlayerMeshes;
  private ball: THREE.Mesh;
  private ballShadow: THREE.Mesh;
  private shadows: THREE.InstancedMesh;
  private rings: THREE.Mesh[] = [];
  private arrows: THREE.Mesh[] = [];
  private camTarget = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private tmp = new THREE.Object3D();
  private frameTimes: number[] = [];
  private pixelRatio: number;
  private maxPixelRatio: number;
  cameraMode: CameraMode;
  private shake = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private m: Match,
    readonly opts: RenderOptions,
  ) {
    const q = opts.quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: q !== 'low', powerPreference: 'high-performance' });
    const dpr = window.devicePixelRatio || 1;
    this.maxPixelRatio = q === 'low' ? Math.min(dpr, 0.8) : q === 'medium' ? Math.min(dpr, 1.25) : Math.min(dpr, 2);
    this.pixelRatio = this.maxPixelRatio;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.cameraMode = opts.camera;
    this.camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.5, 600);

    const night = opts.night;
    this.scene.background = new THREE.Color(night ? '#0b1020' : '#8fc3ea');
    this.scene.fog = new THREE.Fog(night ? '#0b1020' : '#a9cfea', 160, 420);
    const hemi = new THREE.HemisphereLight(night ? '#9fb4ff' : '#ffffff', night ? '#1a2a12' : '#3b5a2a', night ? 1.4 : 1.6);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(night ? '#e8eeff' : '#fff4dd', night ? 1.3 : 2.0);
    sun.position.set(-40, 80, 30);
    this.scene.add(sun);

    this.buildPitch(q, night);
    this.buildGoals();
    this.buildStadium(q, night);

    this.players = new PlayerMeshes(m);
    this.scene.add(this.players.group);

    const blob = makeBlobTexture();
    this.shadows = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false }),
      22,
    );
    this.shadows.frustumCulled = false;
    this.scene.add(this.shadows);

    const ballR = BALL_RADIUS * 1.5; // drawn a little bigger so it reads at broadcast distance
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(ballR, 16, 12), new THREE.MeshLambertMaterial({ map: makeBallTexture() }));
    this.scene.add(this.ball);
    this.ballShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.6, 0.6).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false }),
    );
    this.scene.add(this.ballShadow);

    for (let i = 0; i < 4; i++) {
      const col = new THREE.Color(CONTROLLER_COLORS[i]);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.55, 0.75, 24).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, depthWrite: false }),
      );
      ring.visible = false;
      this.scene.add(ring);
      this.rings.push(ring);
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 4).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: col }));
      arrow.visible = false;
      this.scene.add(arrow);
      this.arrows.push(arrow);
    }
    this.resize();
    this.snapCamera();
  }

  private buildPitch(q: Quality, night: boolean): void {
    const W = PITCH_HALF_LENGTH * 2 + PITCH_MARGIN_X * 2;
    const H = PITCH_HALF_WIDTH * 2 + PITCH_MARGIN_Y * 2;
    const tex = makePitchTexture(q === 'low' ? 1536 : 2560, night);
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(W, H).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: tex }));
    this.scene.add(pitch);
    // Surround (running track / concrete) under the stands.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 300).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: night ? '#1d2a1c' : '#2f5a2f' }));
    ground.position.y = -0.02;
    this.scene.add(ground);
  }

  private buildGoals(): void {
    const white = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    const net = new THREE.LineBasicMaterial({ color: '#e8e8e8', transparent: true, opacity: 0.55 });
    for (const s of [-1, 1]) {
      const gx = s * PITCH_HALF_LENGTH;
      const g = new THREE.Group();
      const post = new THREE.CylinderGeometry(0.06, 0.06, GOAL_HEIGHT, 8);
      for (const py of [-GOAL_HALF_WIDTH, GOAL_HALF_WIDTH]) {
        const m = new THREE.Mesh(post, white);
        m.position.copy(toThree(gx, py, GOAL_HEIGHT / 2));
        g.add(m);
      }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, GOAL_HALF_WIDTH * 2, 8).rotateX(Math.PI / 2), white);
      bar.position.copy(toThree(gx, 0, GOAL_HEIGHT));
      g.add(bar);
      // Net as a line grid: back, two sides and roof.
      const pts: number[] = [];
      const back = gx + s * GOAL_DEPTH;
      const push = (a: THREE.Vector3, b: THREE.Vector3) => pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      for (let y = -GOAL_HALF_WIDTH; y <= GOAL_HALF_WIDTH + 1e-6; y += 0.3) {
        push(toThree(back, y, 0), toThree(back, y, GOAL_HEIGHT));
        push(toThree(gx, y, GOAL_HEIGHT), toThree(back, y, GOAL_HEIGHT));
      }
      for (let z = 0; z <= GOAL_HEIGHT + 1e-6; z += 0.3) {
        push(toThree(back, -GOAL_HALF_WIDTH, z), toThree(back, GOAL_HALF_WIDTH, z));
        for (const y of [-GOAL_HALF_WIDTH, GOAL_HALF_WIDTH]) push(toThree(gx, y, z), toThree(back, y, z));
      }
      for (let x = 0; x <= GOAL_DEPTH + 1e-6; x += 0.3) {
        const xx = gx + s * x;
        for (const y of [-GOAL_HALF_WIDTH, GOAL_HALF_WIDTH]) push(toThree(xx, y, 0), toThree(xx, y, GOAL_HEIGHT));
        push(toThree(xx, -GOAL_HALF_WIDTH, GOAL_HEIGHT), toThree(xx, GOAL_HALF_WIDTH, GOAL_HEIGHT));
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      g.add(new THREE.LineSegments(geo, net));
      this.scene.add(g);
    }
    // Corner flags.
    const flagPole = new THREE.CylinderGeometry(0.03, 0.03, 1.5, 6);
    const flag = new THREE.PlaneGeometry(0.4, 0.3);
    const flagMat = new THREE.MeshBasicMaterial({ color: '#ffcc00', side: THREE.DoubleSide });
    for (const sx of [-1, 1])
      for (const sy of [-1, 1]) {
        const p = new THREE.Mesh(flagPole, white);
        p.position.copy(toThree(sx * PITCH_HALF_LENGTH, sy * PITCH_HALF_WIDTH, 0.75));
        this.scene.add(p);
        const f = new THREE.Mesh(flag, flagMat);
        f.position.copy(toThree(sx * PITCH_HALF_LENGTH + 0.2, sy * PITCH_HALF_WIDTH, 1.35));
        this.scene.add(f);
      }
  }

  private buildStadium(q: Quality, night: boolean): void {
    const crowd = makeCrowdTexture(q !== 'low');
    const L = PITCH_HALF_LENGTH;
    const Wd = PITCH_HALF_WIDTH;
    const standMat = (rx: number) => {
      const t = crowd.clone();
      t.needsUpdate = true;
      t.repeat.set(rx, 3);
      return new THREE.MeshLambertMaterial({ map: t, color: night ? '#9aa4c0' : '#ffffff' });
    };
    const roofMat = new THREE.MeshLambertMaterial({ color: night ? '#1a1d26' : '#d8dde4' });
    // Tiered stands: an inclined plane along each side.
    const addStand = (len: number, depth: number, rise: number, cx: number, cz: number, rotY: number, rx: number) => {
      const slope = Math.hypot(depth, rise);
      const g = new THREE.Group();
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(len, slope), standMat(rx));
      plane.rotation.x = -(Math.PI / 2 - Math.atan2(rise, depth));
      plane.position.set(0, rise / 2 + 1.2, -depth / 2);
      g.add(plane);
      const wall = new THREE.Mesh(new THREE.BoxGeometry(len, 1.2, 0.3), new THREE.MeshLambertMaterial({ color: '#2a2f3a' }));
      wall.position.set(0, 0.6, 0);
      g.add(wall);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(len, 0.4, depth * 0.7), roofMat);
      roof.position.set(0, rise + 7, -depth * 0.55);
      g.add(roof);
      g.position.set(cx, 0, cz);
      g.rotation.y = rotY;
      this.scene.add(g);
    };
    const gap = 9;
    addStand(L * 2 + 20, 30, 18, 0, -(Wd + gap), 0, 10); // far side (three -z)
    addStand(L * 2 + 20, 30, 18, 0, Wd + gap + 6, Math.PI, 10); // near side, mostly behind camera
    addStand(Wd * 2 + 20, 26, 15, L + gap, 0, -Math.PI / 2, 5);
    addStand(Wd * 2 + 20, 26, 15, -(L + gap), 0, Math.PI / 2, 5);

    // Advertising boards.
    const boards = makeBoardTexture(['E-FOOTBALL', 'PLAY FAIR', 'MATCHDAY', 'GOAL!', 'KICK OFF', 'FAN ZONE'], ['#0b3d91', '#a01020', '#0a6b3a', '#5a1a8a', '#c25a00', '#203040']);
    const boardMat = (rep: number) => {
      const t = boards.clone();
      t.needsUpdate = true;
      t.repeat.set(rep, 1);
      return new THREE.MeshBasicMaterial({ map: t });
    };
    const side = new THREE.PlaneGeometry(L * 2 + 8, 0.9);
    const end = new THREE.PlaneGeometry(Wd * 2 + 8, 0.9);
    const b1 = new THREE.Mesh(side, boardMat(2));
    b1.position.set(0, 0.45, -(Wd + 4));
    this.scene.add(b1);
    const b2 = new THREE.Mesh(end, boardMat(1));
    b2.position.set(L + 4.5, 0.45, 0);
    b2.rotation.y = -Math.PI / 2;
    this.scene.add(b2);
    const b3 = new THREE.Mesh(end, boardMat(1));
    b3.position.set(-(L + 4.5), 0.45, 0);
    b3.rotation.y = Math.PI / 2;
    this.scene.add(b3);

    if (night) {
      const mat = new THREE.MeshBasicMaterial({ color: '#fffbe8' });
      const pole = new THREE.MeshLambertMaterial({ color: '#555b66' });
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          const p = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 45, 6), pole);
          p.position.set(sx * (L + 18), 22.5, sz * (Wd + 22));
          this.scene.add(p);
          const lamp = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 1), mat);
          lamp.position.set(sx * (L + 18), 46, sz * (Wd + 22));
          lamp.lookAt(0, 0, 0);
          this.scene.add(lamp);
        }
    }
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Camera framing for the current mode, following the ball like a TV camera. */
  private desiredCamera(): { pos: THREE.Vector3; look: THREE.Vector3; fov: number } {
    const b = this.m.ball.pos;
    const tx = Math.max(-PITCH_HALF_LENGTH + 8, Math.min(PITCH_HALF_LENGTH - 8, b.x));
    const ty = b.y;
    switch (this.cameraMode) {
      case 'close':
        return { pos: new THREE.Vector3(tx * 0.95, 13, 30 - ty * 0.3), look: new THREE.Vector3(tx, 0.5, -ty * 0.75), fov: 34 };
      case 'wide':
        return { pos: new THREE.Vector3(tx * 0.6, 42, 72), look: new THREE.Vector3(tx * 0.8, 0, -ty * 0.3), fov: 30 };
      default:
        return { pos: new THREE.Vector3(tx * 0.85, 24, 50 - ty * 0.15), look: new THREE.Vector3(tx, 0, -ty * 0.45), fov: 30 };
    }
  }

  snapCamera(): void {
    const d = this.desiredCamera();
    this.camPos.copy(d.pos);
    this.camTarget.copy(d.look);
    this.camera.fov = d.fov;
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
    this.camera.updateProjectionMatrix();
  }

  addShake(amount: number): void {
    this.shake = Math.max(this.shake, amount);
  }

  render(dt: number): void {
    const m = this.m;
    this.players.update(dt);

    // Blob shadows.
    for (const p of m.players) {
      if (p.sentOff) this.tmp.position.set(0, -50, 0);
      else this.tmp.position.set(p.pos.x, 0.02, -p.pos.y);
      this.tmp.rotation.set(0, 0, 0);
      this.tmp.scale.setScalar(p.action === 'slide' ? 1.6 : 1);
      this.tmp.updateMatrix();
      this.shadows.setMatrixAt(p.idx, this.tmp.matrix);
    }
    this.shadows.instanceMatrix.needsUpdate = true;

    // Ball: position and rolling spin.
    const b = m.ball;
    const prev = this.ball.position.clone();
    this.ball.position.copy(toThree(b.pos.x, b.pos.y, b.pos.z + BALL_RADIUS * 1.5));
    const moved = this.ball.position.clone().sub(prev);
    moved.y = 0;
    const dist = moved.length();
    if (dist > 1e-4 && dist < 3) {
      const axis = new THREE.Vector3(0, 1, 0).cross(moved).normalize();
      this.ball.rotateOnWorldAxis(axis, dist / (BALL_RADIUS * 1.5));
    }
    this.ballShadow.position.set(b.pos.x, 0.025, -b.pos.y);
    const sc = Math.max(0.4, 1 - b.pos.z * 0.08);
    this.ballShadow.scale.setScalar(sc);

    // Controlled-player rings and arrows.
    for (let i = 0; i < 4; i++) {
      const c = m.controllers[i];
      const p = c ? m.players[c.player] : undefined;
      const show = !!p && !p.sentOff && m.phase !== 'fulltime';
      this.rings[i].visible = show;
      this.arrows[i].visible = show;
      if (!show || !p) continue;
      this.rings[i].position.set(p.pos.x, 0.03, -p.pos.y);
      this.arrows[i].position.set(p.pos.x, 2.35 + Math.sin(performance.now() / 200) * 0.06, -p.pos.y);
      this.arrows[i].rotation.y += dt * 2;
      (this.rings[i].material as THREE.MeshBasicMaterial).color.set(CONTROLLER_COLORS[c.id % 4]);
      (this.arrows[i].material as THREE.MeshBasicMaterial).color.set(CONTROLLER_COLORS[c.id % 4]);
    }

    // Camera follow with smoothing.
    const d = this.desiredCamera();
    const k = 1 - Math.exp(-dt * 3.2);
    this.camPos.lerp(d.pos, k);
    this.camTarget.lerp(d.look, 1 - Math.exp(-dt * 4.5));
    this.camera.position.copy(this.camPos);
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 1.5);
    }
    if (Math.abs(this.camera.fov - d.fov) > 0.01) {
      this.camera.fov += (d.fov - this.camera.fov) * k;
      this.camera.updateProjectionMatrix();
    }
    this.camera.lookAt(this.camTarget);
    this.renderer.render(this.scene, this.camera);
    this.adaptResolution(dt);
  }

  /** Drop the render resolution if frames are slow, raise it again when there's headroom. */
  private adaptResolution(dt: number): void {
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes = [];
    let next = this.pixelRatio;
    if (avg > 1 / 45) next = Math.max(0.5, this.pixelRatio - 0.15);
    else if (avg < 1 / 58 && this.pixelRatio < this.maxPixelRatio) next = Math.min(this.maxPixelRatio, this.pixelRatio + 0.1);
    if (Math.abs(next - this.pixelRatio) > 0.01) {
      this.pixelRatio = next;
      this.renderer.setPixelRatio(next);
      this.resize();
    }
  }

  get currentPixelRatio(): number {
    return this.pixelRatio;
  }

  /** Screen position (CSS pixels) of a sim point, or null if behind the camera. */
  project(x: number, y: number, z: number): { x: number; y: number } | null {
    const v = toThree(x, y, z).project(this.camera);
    if (v.z > 1) return null;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
  }

  recolor(): void {
    this.players.applyColors();
  }

  dispose(): void {
    this.renderer.dispose();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }
}
