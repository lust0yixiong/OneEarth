import {useFeed} from "./use-feed";
import type {LightningFrame} from "../domain/lightning-frame";
import type {StationSnapshot} from "../domain/weather-stations";

export const weatherCaseTitle = "全球气象站与美洲闪电";
export const weatherCaseCoverage = "全球气象站报告 · GOES‑19/18 美洲卫星视域内的闪电";

const source=(frame:LightningFrame)=>frame.source;
// Station reports may be corrected without advancing the most recent observation time.
const snapshot=(frame:StationSnapshot)=>frame;
export function useWeatherObservations(paused:boolean){
  const stations=useFeed<StationSnapshot>("/api/weather/stations",60000,paused,snapshot);
  const east=useFeed<LightningFrame>("/api/lightning?satellite=19",8000,paused,source);
  const west=useFeed<LightningFrame>("/api/lightning?satellite=18",8000,paused,source);
  return {stations,east,west};
}
