import * as THREE from "three";
import type { EarthOptions } from "./types.js";
import {
  computeSolarState,
  earthOrientation,
  type SolarState,
} from "./solarPosition.js";
import { createLighting } from "./earthLighting.js";
import { createAtmosphere } from "./earthAtmosphere.js";
import { createOrbits } from "./earthOrbit.js";
import { createMarkers } from "./earthMarkers.js";

export const EARTH_RADIUS = 1;

export function createEarthScene(host: HTMLElement, initial: EarthOptions) {
  let opts = initial;
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  const lighting = createLighting(scene);

  const geometry = new THREE.SphereGeometry(EARTH_RADIUS, 128, 128);
  const material = new THREE.MeshPhongMaterial({
    color: 0xffffff,
    specular: new THREE.Color(0x1c2a3a),
    shininess: 14,
  });
  const earth = new THREE.Mesh(geometry, material);
  scene.add(earth);

  let texture: THREE.Texture | null = null;
  new THREE.TextureLoader().load(
    opts.textureUrl,
    (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      texture = t;
      material.map = t;
      material.color.set(0xffffff);
      material.needsUpdate = true;
    },
    undefined,
    () => {
      console.warn(`[EarthGlobe] Missing local texture: ${opts.textureUrl}`);
      material.color.set(0x234a7a);
    },
  );

  const atmosphere = createAtmosphere(EARTH_RADIUS);
  scene.add(atmosphere.mesh);
  const orbits = createOrbits(EARTH_RADIUS);
  scene.add(orbits.group);
  const markers = createMarkers(EARTH_RADIUS);
  earth.add(markers.group);
  markers.set(opts.markers);

  const applyTheme = () => {
    lighting.setTheme(opts.theme);
    atmosphere.setTheme(opts.theme);
    orbits.setTheme(opts.theme);
    renderer.toneMappingExposure = opts.theme === "dark" ? 1.0 : 0.92;
  };
  applyTheme();

  const solar: SolarState = { declination: 0, subsolarLon: 0 };
  let simMs = Date.now();
  let elapsed = 0;

  function resize() {
    const w = Math.max(host.clientWidth, 1);
    const h = Math.max(host.clientHeight, 1);
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    camera.aspect = w / h;
    const fit = Math.min(1, camera.aspect);
    camera.position.set(
      0,
      0,
      (EARTH_RADIUS * 1.75) / (Math.tan((camera.fov * Math.PI) / 360) * fit),
    );
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }
  resize();

  function update(delta: number) {
    const d = Math.min(delta, 0.1); // clamp tab-switch spikes
    elapsed += d;
    const scale = opts.reducedMotion ? 1 : opts.timeScale; // one clock for Sun + Earth
    simMs += d * 1000 * scale;
    computeSolarState(simMs, solar);
    earthOrientation(solar, earth.quaternion);
    const motion = opts.reducedMotion ? 0.15 : 1;
    orbits.update(d, motion);
    markers.update(elapsed, opts.reducedMotion ? 0 : 1);
    renderer.render(scene, camera);
  }

  return {
    update,
    resize,
    setOptions(next: Partial<EarthOptions>) {
      const themeChanged = next.theme && next.theme !== opts.theme;
      const markersChanged = next.markers && next.markers !== opts.markers;
      opts = { ...opts, ...next };
      if (themeChanged) applyTheme();
      if (markersChanged) markers.set(opts.markers);
    },
    dispose() {
      lighting.dispose();
      atmosphere.dispose();
      orbits.dispose();
      markers.dispose();
      geometry.dispose();
      material.dispose();
      texture?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
