import * as THREE from "three";
import { SUN_DIR } from "./solarPosition.js";

const vert = /* glsl */ `
varying vec3 vN; varying vec3 vV; varying vec3 vWN;
void main(){
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  vV = normalize(-mv.xyz);
  vWN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * mv;
}`;
const frag = /* glsl */ `
uniform vec3 uColor; uniform float uPower; uniform float uIntensity; uniform vec3 uSun;
varying vec3 vN; varying vec3 vV; varying vec3 vWN;
void main(){
  float rim = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), uPower);
  float lit = mix(0.25, 1.0, smoothstep(-0.25, 0.45, dot(normalize(vWN), uSun)));
  gl_FragColor = vec4(uColor, clamp(rim * uIntensity * lit, 0.0, 1.0));
}`;

export function createAtmosphere(earthRadius: number) {
  const geometry = new THREE.SphereGeometry(earthRadius * 1.035, 64, 64);
  const material = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(0x4f8cff) },
      uPower: { value: 3.2 },
      uIntensity: { value: 0.9 },
      uSun: { value: SUN_DIR.clone() },
    },
  });
  const mesh = new THREE.Mesh(geometry, material);
  return {
    mesh,
    setTheme(theme: "dark" | "light") {
      const u = material.uniforms;
      if (theme === "dark") {
        material.blending = THREE.AdditiveBlending;
        u.uColor.value.set(0x4f8cff);
        u.uIntensity.value = 0.9;
      } else {
        material.blending = THREE.NormalBlending;
        u.uColor.value.set(0x2a63d6);
        u.uIntensity.value = 0.7;
      }
      material.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
