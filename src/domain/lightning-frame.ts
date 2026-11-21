export interface LightningFrame {
  start: number;
  end: number;
  source: string;
  // UTC milliseconds, longitude, latitude
  flashes: [number, number, number][];
}
