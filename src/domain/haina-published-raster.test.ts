import assert from "node:assert/strict";
import {test} from "node:test";
import {pointInHainaFootprint} from "./haina-published-raster";
import type {Coordinate} from "./types";

test("Harbin adjoining patches use native footprints across overlapping envelopes", () => {
  const west: Coordinate[] = [[126.51067358794356,45.87031677558817],[126.52715023587915,45.8706747462651],[126.52766082609557,45.85916477485103],[126.5111875716972,45.858806947067784],[126.51067358794356,45.87031677558817]];
  const east: Coordinate[] = [[126.52715023587915,45.8706747462651],[126.54362719419305,45.871030343263605],[126.54413439063947,45.85952022990159],[126.52766082609557,45.85916477485103],[126.52715023587915,45.8706747462651]];
  const westernClick: Coordinate = [126.52722556896494,45.864919765374715];
  const easternClick: Coordinate = [126.52758556936317,45.86491976508372];
  assert.ok(pointInHainaFootprint(westernClick,west));
  assert.ok(!pointInHainaFootprint(westernClick,east));
  assert.ok(pointInHainaFootprint(easternClick,east));
  assert.ok(!pointInHainaFootprint(easternClick,west));
  assert.ok(!pointInHainaFootprint([126.51,45.858],west));
});
