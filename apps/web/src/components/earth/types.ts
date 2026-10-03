export type MarkerStatus = "healthy" | "warning" | "critical";
export type EarthTheme = "dark" | "light";

/** Only pass markers with verified lat/lon. Never invent coordinates. */
export interface EarthMarker {
  id: string;
  lat: number;
  lon: number;
  status: MarkerStatus;
  label?: string;
}

export interface EarthOptions {
  theme: EarthTheme;
  reducedMotion: boolean;
  /** Simulated seconds per real second. 1 = real time. Sun and Earth share this one clock. */
  timeScale: number;
  textureUrl: string;
  markers: EarthMarker[];
}
