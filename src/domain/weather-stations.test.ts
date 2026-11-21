import test from "node:test";
import assert from "node:assert/strict";
import {parseStations} from "../../server/weather-stations";

test("METAR markers use reported weather and the latest located observation per station",()=>{
  const csv=["station_id,longitude,latitude,observation_time,wx_string,temp_c,wind_speed_kt,raw_text",
    'AAAA,0,0,2026-11-13T12:00:00Z,VCTS RA,0,0,"remarks, not weather"',
    "AAAA,0,0,2026-11-13T11:00:00Z,RA,8,2,",
    "BBBB,1,2,2026-11-13T12:00:00Z,,1,,TSNO TEMPO TSRA",
    "CCCC,-3,4,2026-11-13T12:00:00Z,-TSRA,2,3,",
    "DDDD,,4,2026-11-13T12:30:00Z,TS,3,4,"].join("\n");
  const {stations,latest}=parseStations(csv,new Map([["AAAA","Airport A"]]));
  assert.deepEqual(stations.map(s=>s.storm),[true,false,true]);
  assert.deepEqual(stations[0],{id:"AAAA",name:"Airport A",point:[0,0],observed:latest,weather:"VCTS RA",temperature:0,wind:0,storm:true});
  assert.equal(latest,Date.parse("2026-11-13T12:00:00Z"));
  assert.equal(stations[1].wind,null);
});
