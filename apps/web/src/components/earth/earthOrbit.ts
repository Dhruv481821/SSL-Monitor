import * as THREE from "three";

interface OrbitCfg {
  radius: number;
  squash: number;
  incl: number;
  yaw: number;
  opacity: number;
  speed: number;
  nodes: number[];
}

const CFG: OrbitCfg[] = [
  {
    radius: 1.38,
    squash: 1.0,
    incl: 0.5,
    yaw: 0.3,
    opacity: 0.55,
    speed: 0.22,
    nodes: [0, 3.4],
  },
  {
    radius: 1.52,
    squash: 0.94,
    incl: -0.95,
    yaw: 1.7,
    opacity: 0.3,
    speed: -0.16,
    nodes: [1.6],
  },
  {
    radius: 1.66,
    squash: 0.97,
    incl: 1.25,
    yaw: -0.8,
    opacity: 0.16,
    speed: 0.11,
    nodes: [4.2],
  },
];

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createOrbits(earthRadius: number) {
  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const lineMats: THREE.LineBasicMaterial[] = [];
  const tex = glowTexture();
  const nodeMat = new THREE.PointsMaterial({
    map: tex,
    size: 0.085,
    sizeAttenuation: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    color: 0x9cc4ff,
  });
  const nodes: { orbit: number; angle: number }[] = [];
  const orbitGroups: THREE.Group[] = [];

  CFG.forEach((cfg, i) => {
    const g = new THREE.Group();
    g.rotation.set(cfg.incl, cfg.yaw, 0);
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k < 256; k++) {
      const a = (k / 256) * Math.PI * 2;
      pts.push(
        new THREE.Vector3(
          Math.cos(a) * cfg.radius * earthRadius,
          0,
          Math.sin(a) * cfg.radius * earthRadius * cfg.squash,
        ),
      );
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color: 0x7fb0ff,
      transparent: true,
      opacity: cfg.opacity,
      depthWrite: false,
    });
    g.add(new THREE.LineLoop(geo, mat));
    geos.push(geo);
    lineMats.push(mat);
    cfg.nodes.forEach((a) => nodes.push({ orbit: i, angle: a }));
    orbitGroups.push(g);
    group.add(g);
  });

  const positions = new Float32Array(nodes.length * 3);
  const nodeGeo = new THREE.BufferGeometry();
  nodeGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geos.push(nodeGeo);
  const points = new THREE.Points(nodeGeo, nodeMat);
  points.frustumCulled = false;
  group.add(points);
  // Nodes live in world space of `group`; compute orbit-local -> group transform via each orbit group's matrix.
  const _v = new THREE.Vector3();

  function update(delta: number, motion: number) {
    nodes.forEach((n, idx) => {
      const cfg = CFG[n.orbit];
      n.angle += cfg.speed * delta * motion;
      _v.set(
        Math.cos(n.angle) * cfg.radius * earthRadius,
        0,
        Math.sin(n.angle) * cfg.radius * earthRadius * cfg.squash,
      );
      orbitGroups[n.orbit].updateMatrix();
      _v.applyMatrix4(orbitGroups[n.orbit].matrix);
      positions[idx * 3] = _v.x;
      positions[idx * 3 + 1] = _v.y;
      positions[idx * 3 + 2] = _v.z;
    });
    nodeGeo.attributes.position.needsUpdate = true;
  }
  update(0, 0);

  return {
    group,
    update,
    setTheme(theme: "dark" | "light") {
      const boost = theme === "dark" ? 1 : 1.5;
      lineMats.forEach((m, i) => {
        m.color.set(theme === "dark" ? 0x7fb0ff : 0x2f5fc4);
        m.opacity = Math.min(1, CFG[i].opacity * boost);
      });
      nodeMat.color.set(theme === "dark" ? 0x9cc4ff : 0x2f5fc4);
      nodeMat.blending =
        theme === "dark" ? THREE.AdditiveBlending : THREE.NormalBlending;
      nodeMat.needsUpdate = true;
    },
    dispose() {
      geos.forEach((g) => g.dispose());
      lineMats.forEach((m) => m.dispose());
      nodeMat.dispose();
      tex.dispose();
    },
  };
}
