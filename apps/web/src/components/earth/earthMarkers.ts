import * as THREE from "three";
import type { EarthMarker, MarkerStatus } from "./types.js";
import { latLonToVector } from "./solarPosition.js";

const COLORS: Record<MarkerStatus, number> = {
  healthy: 0x34d399,
  warning: 0xfbbf24,
  critical: 0xf87171,
};

/** Markers are children of the Earth mesh so they rotate with the surface. */
export function createMarkers(earthRadius: number) {
  const group = new THREE.Group();
  const dotGeo = new THREE.SphereGeometry(earthRadius * 0.012, 12, 12);
  const ringGeo = new THREE.RingGeometry(
    earthRadius * 0.014,
    earthRadius * 0.02,
    32,
  );
  const mats: THREE.MeshBasicMaterial[] = [];
  const pulses: { mesh: THREE.Mesh; phase: number }[] = [];
  const _p = new THREE.Vector3();
  const _o = new THREE.Vector3();

  function set(markers: EarthMarker[]) {
    group.clear();
    mats.splice(0).forEach((m) => m.dispose());
    pulses.length = 0;
    for (const m of markers) {
      if (
        !Number.isFinite(m.lat) ||
        !Number.isFinite(m.lon) ||
        Math.abs(m.lat) > 90 ||
        Math.abs(m.lon) > 180
      )
        continue;
      latLonToVector(m.lat, m.lon, earthRadius * 1.004, _p);
      const dotMat = new THREE.MeshBasicMaterial({ color: COLORS[m.status] });
      const ringMat = new THREE.MeshBasicMaterial({
        color: COLORS[m.status],
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      mats.push(dotMat, ringMat);
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.copy(_p);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.copy(_p);
      ring.lookAt(_o.copy(_p).multiplyScalar(2));
      group.add(dot, ring);
      pulses.push({ mesh: ring, phase: Math.random() * Math.PI * 2 });
    }
  }

  function update(time: number, motion: number) {
    for (const p of pulses) {
      const t = motion > 0 ? (time * 0.6 + p.phase) % 1 : 0;
      p.mesh.scale.setScalar(1 + t * 2.2);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity =
        motion > 0 ? 0.6 * (1 - t) : 0.35;
    }
  }

  return {
    group,
    set,
    update,
    dispose() {
      dotGeo.dispose();
      ringGeo.dispose();
      mats.forEach((m) => m.dispose());
    },
  };
}
