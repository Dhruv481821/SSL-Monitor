import * as THREE from "three";

const RAD = Math.PI / 180;
export const AXIAL_TILT = 23.44 * RAD;

export interface SolarState {
  declination: number; // radians
  subsolarLon: number; // radians, east positive, [-PI, PI]
}

/** Approximate solar position (NOAA/Almanac low-precision series), from a UTC epoch in ms. */
export function computeSolarState(utcMs: number, out: SolarState): SolarState {
  const n = utcMs / 86400000 + 2440587.5 - 2451545.0; // days since J2000
  const L = (280.46 + 0.9856474 * n) * RAD; // mean longitude
  const g = (357.528 + 0.9856003 * n) * RAD; // mean anomaly
  const lambda = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD; // ecliptic longitude
  const eps = (23.439 - 0.0000004 * n) * RAD;
  out.declination = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const gmst = (280.46061837 + 360.98564736629 * n) * RAD;
  let lon = (ra - gmst) % (2 * Math.PI);
  if (lon > Math.PI) lon -= 2 * Math.PI;
  if (lon < -Math.PI) lon += 2 * Math.PI;
  out.subsolarLon = lon;
  return out;
}

/** World frame: the Sun is fixed along SUN_DIR. Earth's orientation is solved so the real
 *  subsolar point (lat = declination, lon from UTC) faces the Sun. One coordinate system. */
export const SUN_DIR = new THREE.Vector3(0.82, 0.18, 0.54).normalize();

const UP = new THREE.Vector3(0, 1, 0);
const _P = new THREE.Vector3();
const _N = new THREE.Vector3();
const _Se = new THREE.Vector3();
const _T = new THREE.Vector3();
const _ex = new THREE.Vector3();
const _ez = new THREE.Vector3();
const _m = new THREE.Matrix4();

// Perpendicular to the Sun direction, rolled by the axial tilt for a visible planetary lean.
const P_BASE = UP.clone()
  .addScaledVector(SUN_DIR, -UP.dot(SUN_DIR))
  .normalize()
  .applyAxisAngle(SUN_DIR, -AXIAL_TILT);

/** Writes Earth's orientation (texture lon 0 = +X, east = -Z, as SphereGeometry maps it). */
export function earthOrientation(
  s: SolarState,
  out: THREE.Quaternion,
): THREE.Quaternion {
  _P.copy(P_BASE);
  _N.copy(SUN_DIR)
    .multiplyScalar(Math.sin(s.declination))
    .addScaledVector(_P, Math.cos(s.declination))
    .normalize();
  _Se.copy(SUN_DIR).addScaledVector(_N, -SUN_DIR.dot(_N)).normalize();
  _T.crossVectors(_N, _Se);
  const c = Math.cos(s.subsolarLon);
  const sn = Math.sin(s.subsolarLon);
  _ex.copy(_Se).multiplyScalar(c).addScaledVector(_T, -sn);
  _ez.crossVectors(_ex, _N);
  _m.makeBasis(_ex, _N, _ez);
  return out.setFromRotationMatrix(_m);
}

/** Earth-fixed unit vector for lat/lon in degrees, matching SphereGeometry UVs. */
export function latLonToVector(
  latDeg: number,
  lonDeg: number,
  radius: number,
  out: THREE.Vector3,
) {
  const la = latDeg * RAD;
  const lo = lonDeg * RAD;
  return out
    .set(
      Math.cos(la) * Math.cos(lo),
      Math.sin(la),
      -Math.cos(la) * Math.sin(lo),
    )
    .multiplyScalar(radius);
}
