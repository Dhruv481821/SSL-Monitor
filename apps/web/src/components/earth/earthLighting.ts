import * as THREE from "three";
import { SUN_DIR } from "./solarPosition.js";

export function createLighting(scene: THREE.Scene) {
  const sun = new THREE.DirectionalLight(0xfff4e5, 3.0);
  sun.position.copy(SUN_DIR).multiplyScalar(30);
  const hemi = new THREE.HemisphereLight(0x5b7fb5, 0x05070d, 0.28); // night-side readability
  const ambient = new THREE.AmbientLight(0x1b2a44, 0.35);
  scene.add(sun, hemi, ambient);
  return {
    setTheme(theme: "dark" | "light") {
      hemi.intensity = theme === "dark" ? 0.28 : 0.22;
      ambient.intensity = theme === "dark" ? 0.35 : 0.25;
    },
    dispose() {
      scene.remove(sun, hemi, ambient);
      sun.dispose();
      hemi.dispose();
    },
  };
}
