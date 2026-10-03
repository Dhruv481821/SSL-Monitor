import * as THREE from "three";
import { useEffect, useMemo, useRef, useState } from "react";
import { createEarthScene } from "./earthScene.js";
import type { EarthMarker, EarthTheme } from "./types.js";

interface Props {
  markers?: EarthMarker[];
  theme?: EarthTheme;
  /** Simulated seconds per real second (1 = real time). Default makes rotation visible. */
  timeScale?: number;
  textureUrl?: string;
  className?: string;
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export default function EarthGlobe({
  markers,
  theme = "dark",
  timeScale = 600,
  textureUrl = "/earth/earth-surface.png",
  className,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<ReturnType<typeof createEarthScene> | null>(null);
  const webgl = useMemo(hasWebGL, []);
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const stableMarkers = useMemo(() => markers ?? [], [markers]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !webgl) return;
    const api = createEarthScene(host, {
      theme,
      reducedMotion: reduced,
      timeScale,
      textureUrl,
      markers: stableMarkers,
    });
    apiRef.current = api;
    const clock = new THREE.Clock();
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      api.update(clock.getDelta());
    };
    loop();
    const ro = new ResizeObserver(() => api.resize());
    ro.observe(host);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      api.dispose();
      apiRef.current = null;
    };
    // Scene is created once per texture/webgl; other props are pushed via setOptions below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webgl, textureUrl]);

  useEffect(() => {
    apiRef.current?.setOptions({
      theme,
      reducedMotion: reduced,
      timeScale,
      markers: stableMarkers,
    });
  }, [theme, reduced, timeScale, stableMarkers]);

  if (!webgl) {
    return (
      <div
        className={className}
        role="img"
        aria-label="Earth visualization unavailable"
        style={{ display: "grid", placeItems: "center", textAlign: "center" }}
      >
        <div>
          <img
            src={textureUrl}
            alt=""
            style={{
              width: 160,
              height: 160,
              borderRadius: "50%",
              objectFit: "cover",
              opacity: 0.85,
            }}
          />
          <p style={{ marginTop: 12, fontSize: 13, opacity: 0.7 }}>
            3D view requires WebGL, which is unavailable in this browser.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div
      ref={hostRef}
      className={className}
      style={{ width: "100%", height: "100%", minHeight: 240 }}
    />
  );
}
