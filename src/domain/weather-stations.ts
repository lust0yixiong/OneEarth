import type {Coordinate} from "./types";

export interface WeatherStation {
  id: string;
  name: string;
  point: Coordinate;
  observed: number;
  weather: string;
  temperature: number | null;
  wind: number | null;
  storm: boolean;
}

export interface StationSnapshot {
  stations: WeatherStation[];
  latest: number;
  snapshotId?: string;
}
