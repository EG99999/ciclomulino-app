// Renderer 3D di Open Trainer: 4 stili (voxel, low-poly retrò, diorama isometrico, HD-2D) sullo stesso mondo.
// Usa lo stato condiviso G.V (distanza, pendenza, divisa, ostacoli...) e la logica di gioco di scene.js.
import * as G from './scene.js';
import { Path } from './path3d.js';
import { CH, ROAD_HALF, hsh, terrainH, chunkDecor, chunkHazards, chunkCrossings } from './layout3d.js';
import * as M from './models3d.js';

const V = G.V;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const GROUND = { country: [0x5aa844, 0x4e9a3a], hills: [0xb9c25a, 0xa3b04a], mountains: [0x5f8f5f, 0x547f55], city: [0x4a4a5c, 0x424254] };
export const STYLES = {
  voxel: { name: 'Voxel', px: 4, levels: 7, dither: 0.0, blur: 0, bloom: 0, vig: 0.25, grain: 0, top: 0x5aa6ea, bottom: 0xd6efff, fog: [0xd6efff, 70, 280], W: 90, amp: 9, quant: 1.5, lim: 40, skirt: false, ortho: false, fov: 58, hemi: [0xdff0ff, 0x6b8a4a, 0.9], sun: [0xfff2d0, 0.85], sprite: false, mountains: true, flat: true, view: 260 },
  ps1: { name: 'Low-poly retrò', px: 2.5, levels: 9, dither: 0.7, blur: 0, bloom: 0.1, vig: 0.45, grain: 0.07, top: 0x2b2160, bottom: 0xff9c6b, fog: [0xc47a86, 25, 190], W: 90, amp: 13, quant: 0, lim: 40, skirt: false, ortho: false, fov: 62, hemi: [0xffc7a0, 0x3a2a55, 0.75], sun: [0xff9a55, 0.95], sprite: false, mountains: true, flat: true, view: 200 },
  iso: { name: 'Diorama isometrico', px: 3, levels: 10, dither: 0.25, blur: 0.9, bloom: 0, focus: 0.5, vig: 0.5, grain: 0, top: 0xe9dcbc, bottom: 0xe9dcbc, fog: null, W: 24, amp: 2.2, quant: 0, lim: 20, skirt: true, ortho: true, fov: 50, hemi: [0xffffff, 0xa6a0c4, 0.75], sun: [0xfff1d4, 1.0], sprite: false, mountains: false, flat: false, view: 110, bg: 0xe9dcbc },
  hd2d: { name: 'HD-2D', px: 1, levels: 0, dither: 0, blur: 0.55, bloom: 0.3, focus: 0.72, vig: 0.55, grain: 0.02, top: 0x3c78c8, bottom: 0xffd9a0, fog: [0xf3d9b0, 45, 320], W: 100, amp: 11, quant: 0, lim: 42, skirt: false, ortho: false, fov: 34, hemi: [0xfff0d8, 0x7a8a60, 0.8], sun: [0xffcf90, 1.05], sprite: true, mountains: true, flat: false, view: 300 }
};
const colorMix = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t);

export class World3D {
  constructor(canvas) {
    this.canvas = canvas; this.ok = false; this.on = false; this.style = STYLES.voxel; this.key = 'voxel'; this.quality = 3; this.chunks = new Map(); this.movObj = new Map(); this.cross = new Map(); this.birds = []; this.route = null; this.sprites = null;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' }); this.renderer.setPixelRatio(1);
      this.scene = new THREE.Scene(); this.persp = new THREE.PerspectiveCamera(58, 1, 0.3, 800); this.ortho = new THREE.OrthographicCamera(-24, 24, 17, -17, -300, 500); this.scene.add(this.persp);
      this.hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 0.8); this.sun = new THREE.DirectionalLight(0xffffff, 0.9); this.scene.add(this.hemi, this.sun, this.sun.target);
      this._sky(); this._post(); this.world = new THREE.Group(); this.scene.add(this.world); this.actors = new THREE.Group(); this.scene.add(this.actors);
      this.chunks = new Map(); this.path = new Path(null); this.route = null; this.sprites = null; this.movObj = new Map(); this.cross = new Map(); this.birds = [];
      this.camPos = new THREE.Vector3(); this.camInit = false; this.tick = 0; this.sig = ''; this.ok = true;
      canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.fail(new Error('contesto WebGL perso')); });
    } catch (e) { this.err = e; this.ok = false; }
  }
  active() { return this.ok && this.on; }
  /** errore nel 3D (contesto WebGL perso, GPU in difficoltà...): torna da solo al Pixel 2D */
  fail(e) { console.error(e); this.on = false; this.ok = false; this.canvas.hidden = true; const c2 = document.getElementById('scene'); if (c2) c2.hidden = false; this.onFail && this.onFail(e); }
  setOn(on) { this.on = on && this.ok; this.canvas.hidden = !this.on; }
  _sky() {
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 12), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(-0.5, 0.35, -0.6).normalize() } },
      vertexShader: 'varying vec3 d; void main(){ d=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform vec3 top,bottom,sunDir; varying vec3 d; void main(){ float h=clamp(d.y*1.5+0.1,0.0,1.0); vec3 c=mix(bottom,top,pow(h,0.7)); float s=max(dot(normalize(d),normalize(sunDir)),0.0); c+=vec3(1.0,0.92,0.7)*(pow(s,400.0)*1.4+pow(s,10.0)*0.1); gl_FragColor=vec4(c,1.0);}' }));
    this.scene.add(this.sky);
  }
  _post() {
    this.qScene = new THREE.Scene(); this.qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.qMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, res: { value: new THREE.Vector2(1, 1) }, levels: { value: 0 }, dither: { value: 0 }, blur: { value: 0 }, focus: { value: 0.58 }, bloom: { value: 0 }, vig: { value: 0 }, grain: { value: 0 }, time: { value: 0 }, flash: { value: 0 }, tint: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0);}',
      fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 res; uniform float levels,dither,blur,focus,bloom,vig,grain,time,flash,tint; varying vec2 vUv;
float ign(vec2 p){ return fract(52.9829189*fract(dot(p,vec2(0.06711056,0.00583715)))); }
void main(){
  vec2 px=1.0/res; vec3 c=texture2D(tDiffuse,vUv).rgb;
  float r=blur*abs(vUv.y-focus)*res.y*0.03;
  if(r>0.6){ vec3 s=c; float n=1.0;
    for(int i=0;i<8;i++){ float a=float(i)*0.7853982; vec2 o=vec2(cos(a),sin(a))*r*px; s+=texture2D(tDiffuse,vUv+o).rgb; s+=texture2D(tDiffuse,vUv+o*0.5).rgb; n+=2.0; }
    c=s/n; }
  if(bloom>0.0){ vec3 b=vec3(0.0); for(int i=0;i<8;i++){ float a=float(i)*0.7853982; vec2 o=vec2(cos(a),sin(a))*7.0*px; b+=max(texture2D(tDiffuse,vUv+o).rgb-0.7,0.0); } c+=b/8.0*bloom*2.4; }
  c*=mix(1.0,smoothstep(0.95,0.3,distance(vUv,vec2(0.5))),vig);
  c=mix(c,vec3(1.0,0.2,0.25),flash*0.35+tint*0.12);
  c+=(ign(gl_FragCoord.xy+time)-0.5)*grain;
  if(levels>1.0){ float d=(ign(gl_FragCoord.xy)-0.5)*dither/levels; c=floor((c+d)*levels+0.5)/levels; }
  gl_FragColor=vec4(c,1.0);
}`, depthTest: false, depthWrite: false });
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.qMat); q.frustumCulled = false; this.qScene.add(q);
  }
  resize() {
    const st = this.style, mul = this.quality >= 3 ? 1 : this.quality === 2 ? 1.6 : 2.4, px = Math.max(1, st.px * mul);
    const w = Math.max(160, Math.ceil(innerWidth / px)), h = Math.max(90, Math.ceil(innerHeight / px));
    this.renderer.setSize(w, h, false); if (this.rt) this.rt.dispose();
    this.rt = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
    this.qMat.uniforms.res.value.set(w, h); this.persp.aspect = w / h; this.persp.updateProjectionMatrix();
    const s = 17; this.ortho.left = -s * w / h; this.ortho.right = s * w / h; this.ortho.top = s; this.ortho.bottom = -s; this.ortho.updateProjectionMatrix();
    this.canvas.style.imageRendering = px > 1 ? 'pixelated' : 'auto';
  }
  setQuality(q) { this.quality = q; if (this.ok) this.resize(); }
  setRoute(route) { this.route = route; if (!this.ok) return; this.path = new Path(route); this.clearWorld(); }
  envOf(d) { return V.theme !== 'auto' ? V.theme : this.route ? this.route.env(d) : G.envAt(d); }
  setStyle(key) {
    if (!this.ok) return; this.key = STYLES[key] ? key : 'voxel'; const st = this.style = STYLES[this.key];
    this.scene.background = new THREE.Color(st.bg || st.bottom); this.scene.fog = st.fog ? new THREE.Fog(st.fog[0], st.fog[1], st.fog[2]) : null;
    this.sky.material.uniforms.top.value.set(st.top); this.sky.material.uniforms.bottom.value.set(st.bottom);
    this.hemi.color.set(st.hemi[0]); this.hemi.groundColor.set(st.hemi[1]); this.hemi.intensity = st.hemi[2]; this.sun.color.set(st.sun[0]); this.sun.intensity = st.sun[1];
    const u = this.qMat.uniforms; u.levels.value = st.levels; u.dither.value = st.dither; u.blur.value = st.blur; u.focus.value = st.focus || 0.58; u.bloom.value = st.bloom; u.vig.value = st.vig; u.grain.value = st.grain;
    this.persp.fov = st.fov; this.persp.far = st.view + 300; this.persp.updateProjectionMatrix();
    this.matV = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    if (st.sprite && !this.sprites) this.sprites = M.makeSprites();
    this.clearWorld(); this.clearActors(); this.camInit = false; this.resize();
  }
  /* ---------- mondo a pezzi ---------- */
  clearWorld() { for (const g of this.chunks.values()) this._dispose(g); this.chunks.clear(); }
  _dispose(g) { this.world.remove(g); g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
  _killBubble(b) { if (!b) return; if (b.parent) b.parent.remove(b); if (b.material) { if (b.material.map) b.material.map.dispose(); b.material.dispose(); } }
  clearActors() { for (const o of this.movObj.values()) this.actors.remove(o.g); this.movObj.clear(); for (const o of this.cross.values()) this.actors.remove(o); this.cross.clear(); if (this.rider) { this.actors.remove(this.rider.g); this.rider = null; } for (const b of this.birds) this.actors.remove(b.g); this.birds = []; this.sig = ''; if (this.fp) { this.persp.remove(this.fp); this.fp = null; } }
  _groundColor(d, lat, row) {
    const env = this.envOf(d), env2 = this.envOf(d + 40), base = GROUND[env] || GROUND.country, other = GROUND[env2] || base, ch = Math.floor(d / 8 + lat / 10) % 2 ? 0 : 1;
    if (Math.abs(lat) < 6) return new THREE.Color(env === 'city' ? 0x6a6a7a : 0x8a8a70);
    return colorMix(base[ch], other[ch], env === env2 ? 0 : 0.5);
  }
  _buildChunk(c) {
    const st = this.style, P = this.path, grp = new THREE.Group(), d0 = c * CH, d1 = d0 + CH, step = st.quant ? 6 : 4;
    // terreno
    const W = st.W, lats = [-W, -W * 0.55, -30, -16, -8, -4.4, 4.4, 8, 16, 30, W * 0.55, W].filter(v => Math.abs(v) <= W).sort((a, b) => a - b).filter((v, i, a) => !i || v > a[i - 1]);
    const tm = new THREE.Group(), T = new M.Merger(); T.recompute = true; let rows = [], cols = [];
    for (let d = d0; d <= d1 + 0.01; d += step) { const row = [], col = []; for (const lat of lats) { const f = P.frame(d, lat); row.push([f.x, f.y + terrainH(d, lat, st.amp, st.quant) - (Math.abs(lat) < 4.4 ? 0.04 : 0), f.z]); col.push(this._groundColor(d, lat)); } rows.push(row); cols.push(col); }
    T.strip(rows, cols);
    // strada, bordi, tratteggio
    const R = new M.Merger(); R.recompute = true;
    const road = [], rcol = []; for (let d = d0; d <= d1 + 0.01; d += 4) { const a = P.frame(d, -ROAD_HALF), b = P.frame(d, ROAD_HALF); road.push([[a.x, a.y + 0.05, a.z], [b.x, b.y + 0.05, b.z]]); const k = Math.floor(d / 12) % 2 ? 0x5a5a68 : 0x52525f; rcol.push([new THREE.Color(k), new THREE.Color(k)]); }
    R.strip(road, rcol);
    for (const [l0, l1] of [[-3.7, -3.4], [3.4, 3.7]]) { const rr = [], cc = []; for (let d = d0; d <= d1 + 0.01; d += 4) { const a = P.frame(d, l0), b = P.frame(d, l1); rr.push([[a.x, a.y + 0.09, a.z], [b.x, b.y + 0.09, b.z]]); const k = Math.floor(d / 8) % 2 ? 0xf0f0f0 : 0xd93a3a; cc.push([new THREE.Color(k), new THREE.Color(k)]); } R.strip(rr, cc); }
    for (let d = Math.ceil(d0 / 12) * 12; d < d1; d += 12) { const rr = [], cc = []; for (const dd of [d, d + 4]) { const a = P.frame(dd, -0.12), b = P.frame(dd, 0.12); rr.push([[a.x, a.y + 0.1, a.z], [b.x, b.y + 0.1, b.z]]); cc.push([new THREE.Color(0xf1e9b0), new THREE.Color(0xf1e9b0)]); } R.strip(rr, cc); }
    // incroci con strisce pedonali
    const D = new M.Merger();
    for (const dc of chunkCrossings(c, G.XING)) {
      if (this.envOf(dc) === 'mountains') continue; const f = P.frame(dc, 0);
      D.box(70, 0.06, 8, 0x555566, f.x, f.y + 0.045, f.z, f.yaw + Math.PI / 2);
      for (const off of [-6.2, 6.2]) for (let i = -3; i <= 3; i++) { const q = P.frame(dc + off, i * 1.0); D.box(0.55, 0.05, 1.4, 0xf4f4f4, q.x, q.y + 0.1, q.z, q.yaw); }
    }
    // ostacoli
    for (const h of chunkHazards(c, G.hazards, G.TRACK)) { if (!V.hazards) break; const f = P.frame(h.d, h.lane * ROAD_HALF); M.addHazard(D, h, { x: f.x, y: f.y + 0.05, z: f.z, yaw: f.yaw }); if (h.type === 'works') { const q = P.frame(h.d - 40, ROAD_HALF + 2); D.box(0.1, 2.2, 0.1, 0x666666, q.x, q.y, q.z); D.box(1.1, 0.8, 0.1, 0xffd24a, q.x, q.y + 2.2, q.z, q.yaw); } }
    // scenario
    const items = chunkDecor(c, { envOf: d => this.envOf(d), path: P, amp: st.amp, quant: st.quant, lim: st.lim });
    if (st.sprite) {
      for (const it of items) { const s = this._decorSprite(it); if (s) grp.add(s); }
    } else for (const it of items) { const fn = M.DECOR[it.type]; if (fn) fn(D, it.x, it.y, it.z, it.yaw, it.k); }
    if (st.mountains) {                                    // montagne lontane, che sfumano nella nebbia
      const MM = new M.Merger();
      for (let j = 0; j < 2; j++) { const seed = c * 53 + j; if (hsh(seed) < 0.55) { const side = hsh(seed + 1) < 0.5 ? -1 : 1, lat = side * (230 + hsh(seed + 2) * 140), d = d0 + hsh(seed + 3) * CH, f = P.frame(d, lat), hgt = 70 + hsh(seed + 4) * 110, w = 110 + hsh(seed + 5) * 90, hi = this.envOf(d) === 'mountains';
        MM.pyramid(w, hgt, w * 0.8, hi ? 0x8a93b0 : 0x6f9a8a, f.x, f.y - 4, f.z, hsh(seed) * 3); if (hi) MM.pyramid(w * 0.34, hgt * 0.3, w * 0.27, 0xf4f8ff, f.x, f.y - 4 + hgt * 0.7, f.z, 0); } }
      grp.add(MM.mesh(this.matV));
    }
    if (st.skirt) { const S2 = new M.Merger(); for (const side of [-1, 1]) { const rr = [], cc = []; for (let d = d0; d <= d1 + 0.01; d += 6) { const f = P.frame(d, side * W), y = f.y + terrainH(d, side * W, st.amp, st.quant); rr.push([[f.x, y, f.z], [f.x, y - 7, f.z]]); cc.push([new THREE.Color(0x73a047), new THREE.Color(Math.floor(d / 6) % 2 ? 0x8a5a3a : 0x7a4e32)]); } S2.strip(rr, cc); } grp.add(S2.mesh(this.matV)); }
    grp.add(T.mesh(this.matV), R.mesh(this.matV), D.mesh(this.matV)); this.world.add(grp); return grp;
  }
  _decorSprite(it) {
    const S = this.sprites, size = { tree: [5, 6.3, S.tree], cyp: [2.2, 6.6, S.cyp], pine: [4.5, 6.8, S.pine], house: [8, 6, S.house], cow: [3, 1.8, S.cow], sheep: [1.8, 1.2, S.sheep], goat: [1.8, 1.4, S.goat], bush: [2.6, 1.7, S.bush], rock: [3.6, 2.2, S.rock], hay: [2.4, 2, S.hay], flower: [2.6, 1.5, S.flower], fence: [5, 1.4, S.fence], vine: [5, 1.6, S.vine], bld: [6 + hsh(it.k) * 3, 12 + hsh(it.k + 5) * 12, S.bld], lamp: [1.6, 5, S.lamp], banner: [1.4, 4.4, S.banner] }[it.type];
    if (!size) return null; const s = M.sprite(size[2], size[0], size[1], it.y); s.position.x = it.x; s.position.z = it.z; return s;
  }
  _ensureChunks() {
    const a = Math.floor((V.dist - 90) / CH), b = Math.floor((V.dist + this.style.view) / CH); let built = 0;
    for (let c = a; c <= b; c++) if (!this.chunks.has(c) && built < 2) { this.chunks.set(c, this._buildChunk(c)); built++; }
    for (const [c, g] of this.chunks) if (c < a - 1 || c > b + 1) { this._dispose(g); this.chunks.delete(c); }
  }
  /* ---------- attori ---------- */
  _moverObj(m) {
    let o = this.movObj.get(m); if (o) return o; const st = this.style, S = this.sprites; let g;
    const hex = n => '#' + (n >>> 0).toString(16).padStart(6, '0'), cs = typeof m.col === 'string' ? m.col : hex(m.col);
    if (m.type === 'car') g = st.sprite ? M.sprite(S.car(cs, !!m.front), 4.4, 2.6) : M.carMesh(new THREE.Color(cs), !!m.front);
    else if (m.type === 'bike') { const bk = G.BIKES[m.k % G.BIKES.length]; g = st.sprite ? M.sprite(S.bikeNpc(m.sh, bk.frame), 1.2, 2.4) : M.bikerMesh({ shirt: new THREE.Color(m.sh), jersey2: 0xffffff, shorts: 0x1a1a28, helmet: 0xf4f1ff, skin: 0xf0b890, frame: bk.frame, accent: bk.accent, deep: bk.deep, scale: 1 }); }
    else if (m.type === 'tractor') g = st.sprite ? M.sprite(S.tractor, 3.4, 2.4) : M.tractorMesh();
    else g = st.sprite ? M.sprite(S.ped(m.sh), 0.8, 1.9) : M.pedMesh(new THREE.Color(m.sh), m.dog);
    g.visible = false; this.actors.add(g); o = { g, honk: null }; this.movObj.set(m, o); return o;
  }
  _updateMovers() {
    const T = G.TRACK, dist = V.dist, st = this.style;
    for (const m of G.movers) {
      const o = this.movObj.get(m); if (!V.traffic) { if (o) o.g.visible = false; continue; }
      let zabs = m.z0 + m.vel * V.time; zabs = ((zabs % T) + T) % T; const rel = ((zabs - dist + T / 2) % T + T) % T - T / 2;
      if (rel < -30 || rel > st.view * 0.8) { if (o) o.g.visible = false; continue; }
      const d = dist + rel, env = this.envOf(d);
      if (m.type === 'tractor' && env !== 'country') { if (o) o.g.visible = false; continue; }
      if (m.type === 'ped' && env === 'mountains' && m.k % 3) { if (o) o.g.visible = false; continue; }
      const ob = this._moverObj(m), g = ob.g; g.visible = true;
      const lat = m.type === 'ped' ? m.side * (6.4 + (env === 'city' ? 0 : 3) + m.off * 0.12) : m.lane * ROAD_HALF, f = this.path.frame(d, lat);
      g.position.set(f.x, f.y + (m.type === 'ped' ? terrainH(d, lat, st.amp, st.quant) : 0.05), f.z);
      if (!st.sprite) { g.rotation.y = f.yaw + (m.vel < 0 ? Math.PI : 0); const sw = Math.sin(V.time * (m.type === 'ped' ? 6 : 8) + m.k); if (g.userData.legs) g.userData.legs.forEach((l, i) => { l.rotation.x = (i ? -1 : 1) * sw * (m.type === 'ped' ? 0.6 : 0.7); }); }
      else if (m.type === 'ped') g.position.y += Math.abs(Math.sin(V.time * 6 + m.k)) * 0.05;
      if (m.honkUntil > V.time) { if (!ob.honk) { ob.honk = M.bubbleSprite('BEEP!', '#ffd24a'); ob.honk.position.set(0, 2.9, 0); g.add(ob.honk); } } else if (ob.honk) { this._killBubble(ob.honk); ob.honk = null; }
    }
    // auto che attraversano
    for (const x of G.crossers) {
      let o = this.cross.get(x); const T2 = G.TRACK, rel = (((x.zc - dist + T2 / 2) % T2) + T2) % T2 - T2 / 2;
      if (!V.traffic || rel < 8 || rel > 160 || this.envOf(dist + rel) === 'mountains') { if (o) o.visible = false; continue; }
      if (!o) { const cs = typeof x.col === 'string' ? x.col : '#' + (x.col >>> 0).toString(16).padStart(6, '0'); o = st.sprite ? M.sprite(this.sprites.car(cs, false), 4.4, 2.6) : M.carMesh(new THREE.Color(cs), false); this.actors.add(o); this.cross.set(x, o); }
      o.visible = true; const u = (((V.time * x.vx + x.ph) % 6) + 6) % 6 - 3, f = this.path.frame(dist + rel, u * ROAD_HALF * 1.2); o.position.set(f.x, f.y + 0.05, f.z); if (!st.sprite) o.rotation.y = f.yaw + (x.vx > 0 ? -Math.PI / 2 : Math.PI / 2);
    }
  }
  _updateBirds(dt, p) {
    if (!this.birds.length) for (let i = 0; i < 14; i++) { const b = new THREE.Group(); const m1 = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.3), new THREE.MeshBasicMaterial({ color: 0x20202a, side: THREE.DoubleSide })), m2 = m1.clone(); m1.position.x = -0.5; m2.position.x = 0.5; b.add(m1, m2); b.userData = { m1, m2 }; this.actors.add(b); this.birds.push({ g: b, a: hsh(i) * 6.28, r: 25 + hsh(i + 1) * 40, h: 18 + hsh(i + 2) * 22, sp: 0.15 + hsh(i + 3) * 0.2 }); }
    for (const b of this.birds) { b.a += b.sp * dt; b.g.visible = this.key !== 'iso'; b.g.position.set(p.x + Math.cos(b.a) * b.r, p.y + b.h + Math.sin(V.time + b.a) * 1.5, p.z + Math.sin(b.a) * b.r + 20); b.g.rotation.y = -b.a; const f = Math.sin(V.time * 9 + b.a * 5) * 0.6; b.g.userData.m1.rotation.z = f; b.g.userData.m2.rotation.z = -f; }
  }
  _riderSig() { const K = V.kit, B = V.bikeC || {}; return [this.key, V.bike, K.jersey, K.jersey2, K.pattern, K.shorts, K.helmet, K.skin, K.emblem, K.emblemColor, K.text, K.img ? K.img.length : 0, B.frame, B.accent, B.deep].join('|'); }
  _buildRider() {
    if (this.rider) { this.actors.remove(this.rider.g); }
    const st = this.style, K = V.kit, bk = G.curBike();
    if (st.sprite) {
      const cv = G.riderCanvas(); this.riderTex = new THREE.CanvasTexture(cv); this.riderTex.magFilter = THREE.NearestFilter; this.riderTex.minFilter = THREE.NearestFilter;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.riderTex, transparent: true, alphaTest: 0.3, fog: false })); s.center.set(0.5, 0); s.scale.set(2.8, 3.6, 1); this.rider = { g: s, sprite: true };
    } else {
      const bc = document.createElement('canvas'); bc.width = 12; bc.height = 19; G.drawKitBack(bc, K); const t = new THREE.CanvasTexture(bc); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
      const g = M.bikerMesh({ shirt: new THREE.Color(K.jersey), jersey2: new THREE.Color(K.jersey2), shorts: new THREE.Color(K.shorts), helmet: new THREE.Color(K.helmet), skin: new THREE.Color(K.skin), frame: new THREE.Color(bk.frame), accent: new THREE.Color(bk.accent), deep: bk.deep, scale: 1.3, backTex: t });
      this.rider = { g, sprite: false };
    }
    this.actors.add(this.rider.g); this.sig = this._riderSig(); this.bubble = null; this.bubbleText = ''; if (this.fp) { this.persp.remove(this.fp); this.fp = null; }
  }
  _fpRig() {
    if (this.fp) return; const g = new THREE.Group(), K = V.kit, bk = G.curBike();
    M.part(0.72, 0.05, 0.05, 0x3a3a4c, 0, -0.34, -0.7, g);                                           // manubrio
    M.part(0.1, 0.1, 0.24, 0x15151c, -0.3, -0.4, -0.74, g); M.part(0.1, 0.1, 0.24, 0x15151c, 0.3, -0.4, -0.74, g);   // comandi
    M.part(0.07, 0.2, 0.07, bk.frame, 0, -0.55, -0.55, g); M.part(0.14, 0.04, 0.3, bk.accent, 0, -0.36, -0.4, g);      // attacco e telaio
    M.part(0.15, 0.6, 0.15, K.jersey, -0.32, -0.85, -0.5, g).rotation.x = -1.15; M.part(0.15, 0.6, 0.15, K.jersey, 0.32, -0.85, -0.5, g).rotation.x = -1.15;
    this.persp.add(g); this.fp = g;
  }
  _animateRider(dt, p) {
    const R = this.rider, g = R.g, jump = V.jump / 20 * 0.9, lat = V.lat * 0.7 * ROAD_HALF, f = this.path.frame(V.dist, lat);
    g.position.set(f.x, f.y + 0.06 + jump + 0.03 * Math.abs(Math.sin(V.phase * 2)), f.z);
    if (R.sprite) { if ((this.tick & 3) === 0) { const cv = G.riderCanvas(); if (cv) { this.riderTex.image = cv; this.riderTex.needsUpdate = true; } } g.visible = V.cam !== 'first'; return; }
    g.rotation.y = f.yaw; const u = g.userData; u.lean.rotation.z = clamp(V.lean, -1.2, 1.2) * 0.35;
    const stand = V.running && V.slope > 4.5, tuck = V.slope < -2.5, ph = V.running ? V.phase : 0, gn = V.gesture ? V.gesture.name : '', gt = V.gesture ? V.gesture.t : 0;
    u.legs.forEach((l, i) => { l.rotation.x = V.jump > 1 ? 0.3 : Math.sin(ph + i * Math.PI) * 0.7; });
    u.torso.rotation.x = tuck ? 0.85 : stand ? 0.35 : 0.55; u.torso.position.y = stand ? 1.15 : 0.95; u.torso.rotation.z = Math.sin(ph) * (stand ? 0.1 : 0.04);
    u.armL.rotation.set(-0.95, 0, 0); u.armR.rotation.set(-0.95, 0, 0); u.head.rotation.set(0, 0, 0); u.bottle.visible = false;
    if (gn === 'wave' || gn === 'thumbs') { u.armR.rotation.set(-3.0, 0, Math.sin(gt * 14) * 0.4 * (gn === 'wave' ? 1 : 0)); }
    else if (gn === 'cheer' || gn === 'stretch') { u.armR.rotation.set(-3.0, 0, Math.sin(gt * 12) * 0.3); u.armL.rotation.set(-3.0, 0, -Math.sin(gt * 12) * 0.3); }
    else if (gn === 'drink') { u.armR.rotation.set(-2.2, 0, 0.35); u.bottle.visible = true; u.bottle.position.set(0.3, 1.55, 0.35); u.head.rotation.x = -0.3; }
    else if (gn === 'shake') u.head.rotation.y = Math.sin(gt * 18) * 0.5;
    else if (gn === 'bell') u.armR.rotation.set(-1.2, 0, 0);
    g.visible = V.cam !== 'first';
  }
  _bubble(p) {
    const text = V.gesture && V.gesture.say && V.gesture.t > 0.2 && V.gesture.t < V.gesture.dur - 0.2 ? V.gesture.say : V.hitT > 0 ? 'AHI!' : '';
    if (text !== this.bubbleText) { if (this.bubble) { this._killBubble(this.bubble); this.bubble = null; } this.bubbleText = text; if (text && V.cam !== 'first') { this.bubble = M.bubbleSprite(text); this.bubble.position.set(0, this.rider.sprite ? 4.4 : 3.6, 0); this.rider.g.add(this.bubble); } }
  }
  /* ---------- un fotogramma ---------- */
  draw() {
    if (!this.ok) return; const dt = clamp(V.time - (this._lt ?? V.time), 0, 0.2); this._lt = V.time; this.tick++;
    G.trafficTick(); V.env = this.envOf(V.dist);
    this._ensureChunks();
    if (!this.rider || this.sig !== this._riderSig() && (this.tick % 10 === 0)) this._buildRider();
    const st = this.style, P = this.path, dist = V.dist, f = P.frame(dist, 0), lat = V.lat * 0.7 * ROAD_HALF;
    this._updateMovers(); this._animateRider(dt, f); this._bubble(f); this._updateBirds(dt, f);
    // camera
    const fx = Math.sin(f.yaw), fz = Math.cos(f.yaw); let cam = this.persp; const shake = V.shake > 0 ? V.shake * 0.5 : 0;
    const rp = P.frame(dist, lat);
    if (V.cam === 'first') {
      this._fpRig(); this.fp.visible = true; const eye = P.frame(dist + 0.3, lat), la = P.frame(dist + 22, lat * 0.5);
      this.persp.position.set(eye.x, eye.y + 1.45 + V.jump / 20 * 0.9, eye.z); this.persp.lookAt(la.x, la.y + 1.1, la.z); this.persp.rotateZ(clamp(V.lean, -1.2, 1.2) * 0.14);
      this.fp.rotation.z = Math.sin(V.phase) * 0.02; this.fp.position.y = Math.abs(Math.sin(V.phase * 2)) * 0.012; this.sky.visible = true; this.sun.target.position.copy(this.persp.position);
    } else {
      if (this.fp) this.fp.visible = false;
      if (st.ortho) {
        cam = this.ortho; const dd = 60, c = Math.cos(f.yaw), s = Math.sin(f.yaw), ox = -0.7 * dd, oz = -0.7 * dd; const tx = rp.x + (ox * c + oz * s), tz = rp.z + (-ox * s + oz * c), ty = rp.y + dd * 0.85;
        if (!this.camInit) { this.camPos.set(tx, ty, tz); this.camInit = true; } else this.camPos.lerp(new THREE.Vector3(tx, ty, tz), Math.min(1, dt * 4));
        this.ortho.position.copy(this.camPos); this.ortho.lookAt(rp.x, rp.y + 1, rp.z); this.sky.visible = false; this.sun.target.position.set(rp.x, rp.y, rp.z);
      } else {
        const back = st.sprite ? 9 : 6.4, high = st.sprite ? 4.0 : 3.2, cp = P.frame(dist - back, lat * 0.7), la = P.frame(dist + 16, lat * 0.5);
        const target = new THREE.Vector3(cp.x, cp.y + high, cp.z);
        if (!this.camInit) { this.camPos.copy(target); this.camInit = true; } else this.camPos.lerp(target, Math.min(1, dt * 7));
        this.persp.position.copy(this.camPos); this.persp.lookAt(la.x, la.y + 1.4, la.z); this.sky.visible = true; this.sun.target.position.copy(this.camPos);
      }
    }
    if (shake) cam.position.add(new THREE.Vector3((Math.random() - .5) * shake, (Math.random() - .5) * shake, 0));
    this.sky.position.copy(cam.position); this.sun.position.set(cam.position.x - 60, cam.position.y + 90, cam.position.z + 40);
    this.qMat.uniforms.flash.value = V.hitT > 0 ? Math.min(1, V.hitT * 2) : 0; this.qMat.uniforms.tint.value = V.reduced ? 1 : 0; this.qMat.uniforms.time.value = (V.time * 30) % 100;
    this.renderer.setRenderTarget(this.rt); this.renderer.render(this.scene, cam);
    this.renderer.setRenderTarget(null); this.qMat.uniforms.tDiffuse.value = this.rt.texture; this.renderer.render(this.qScene, this.qCam);
    void fx; void fz;
  }
}
