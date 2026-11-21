import {geoArea, geoBounds, geoContains, geoPath} from 'd3-geo';
import {feature, mesh} from 'topojson-client';
import atlas from 'world-atlas/countries-50m.json';
import overviewAtlas from 'world-atlas/countries-110m.json';
import names from './country-names.json';
import marineAreas from './marine-areas.json';

// world-atlas 2.0.2 redistributes Natural Earth 4.1.0 at 1:50 million.
// These generalized atlas units locate the view centre, never a study area.
let latitudeBands, political, overviewPolitical;
const BAND = 5, BAND_COUNT = 180 / BAND, CACHE_LIMIT = 512;
const locations = new Map();
const projectedPaths = new WeakMap();

function bandAt(latitude) {
  return Math.max(0, Math.min(BAND_COUNT - 1, Math.floor((latitude + 90) / BAND)));
}

function prepareLocations() {
  if (latitudeBands) return;
  latitudeBands = Array.from({length: BAND_COUNT}, () => []);
  for (const country of feature(atlas, atlas.objects.countries).features) {
    const bounds = geoBounds(country);
    const name = names.numeric[country.id] || names.atlasName[country.properties?.name]
      || '未命名的图集单元';
    const entry = {country, bounds, name};
    for (let i = bandAt(bounds[0][1]); i <= bandAt(bounds[1][1]); i++) {
      latitudeBands[i].push(entry);
    }
  }
}

function inBounds([[west, south], [east, north]], [longitude, latitude]) {
  // D3 uses west > east for a geographic box crossing the antimeridian.
  return latitude >= south && latitude <= north
    && (west <= east ? longitude >= west && longitude <= east
      : longitude >= west || longitude <= east);
}

// Natural Earth 1:50m marine label areas, v5.1.0. Prefer a named sea or bay
// inside its ocean. These generalized polygons provide orientation only.
let waters;
function marineLabel(point) {
  if (!waters) waters = marineAreas.map(row => {
    const geometry = structuredClone(row.geometry);
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    for (const rings of polygons)
      if (geoArea({type:'Polygon', coordinates:[rings[0]]}) > 2*Math.PI)
        rings.forEach(ring => ring.reverse());
    return {...row,geometry,bounds:geoBounds(geometry),area:geoArea(geometry)};
  }).sort((a,b)=>a.area-b.area);
  const hits=waters.filter(row=>inBounds(row.bounds,point) && geoContains(row.geometry,point));
  const ocean=hits.find(row=>row.ocean)?.name;
  const regional=hits.find(row=>!row.ocean)?.name;
  return [ocean,regional].filter(Boolean).join(' · ');
}

/**
 * @param {[number, number]} point Longitude/latitude in degrees.
 * @param {{scale?: number}} options View zoom multiplier; it does not change the data.
 * @returns {string} Country/atlas-region label for the view centre, with precision stated.
 */
export function geoOrientation(point, {scale = 1} = {}) {
  if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])
    || Math.abs(point[1]) > 90) return '中心位置不可判定';
  const longitude = ((point[0] + 180) % 360 + 360) % 360 - 180;
  const latitude = point[1];
  // Exact coordinates avoid moving a point across a border through cache rounding.
  const key = longitude + ',' + latitude;
  let label = locations.get(key);
  if (label === undefined) {
    prepareLocations();
    const matches = [], countries = [];
    const normalized = [longitude, latitude];
    for (const entry of latitudeBands[bandAt(latitude)]) {
      if (inBounds(entry.bounds, normalized) && geoContains(entry.country, normalized)) {
        if (!matches.includes(entry.name)) matches.push(entry.name);
        countries.push({id:String(entry.country.id).padStart(3,'0'),name:entry.name});
      }
    }
    label = matches.length ? {name:matches.join(' / '),land:true,country:countries.length===1?countries[0]:null} : {name:marineLabel(normalized),land:false,country:null};
    if (locations.size >= CACHE_LIMIT) locations.delete(locations.keys().next().value);
    locations.set(key, label);
  }
  // This generalized atlas supports geographic orientation only.
  // Small islands and inland waters cannot be resolved from this country atlas.
  if (!label.name) return '图集未标注区域（中心点近似定位）';
  return label.name + (label.land && scale >= 32
    ? '（中心点近似定位，仅到国家或地区）'
    : '（中心点近似定位）');
}

/** Only a single matching atlas unit may seed a finer administrative lookup. */
export function geoCountry(point) {
  if(!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || Math.abs(point[1])>90)return null;
  geoOrientation(point);
  const lon=((point[0]+180)%360+360)%360-180;
  const country=locations.get(lon+','+point[1])?.country;
  return country && /^\d{3}$/.test(country.id)?country:null;
}

function borders(scale) {
  // Decode shared international edges once; do not stroke every polygon twice.
  if (scale < 8) return overviewPolitical ??= mesh(overviewAtlas, overviewAtlas.objects.countries, (a,b) => a !== b);
  if (!political) political = mesh(atlas, atlas.objects.countries, (a, b) => a !== b);
  return political;
}

function projectionState(projection) {
  const values = [];
  for (const method of ['scale', 'translate', 'rotate', 'center', 'angle',
    'reflectX', 'reflectY', 'precision', 'clipAngle', 'clipExtent', 'parallels']) {
    values.push(typeof projection[method] === 'function' ? projection[method]() : null);
  }
  return {
    key: JSON.stringify(values),
    preclip: projection.preclip?.(),
    postclip: projection.postclip?.()
  };
}

/** Draw atlas political borders only; preserve the caller's canvas styling. */
export function drawPolitical(ctx, projection, scale = 1) {
  if (!ctx || typeof projection !== 'function') return;
  const geometry = borders(scale);
  ctx.save();
  try {
    ctx.setLineDash([]);
    ctx.strokeStyle = '#617b72';
    ctx.globalAlpha *= 0.65;
    ctx.lineWidth = scale >= 8 ? 0.85 : 0.65;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (typeof Path2D === 'function') {
      const state = projectionState(projection);
      let cached = projectedPaths.get(projection);
      if (!cached || cached.geometry !== geometry || cached.key !== state.key
        || cached.preclip !== state.preclip || cached.postclip !== state.postclip) {
        const path = new Path2D();
        geoPath(projection, path)(geometry);
        cached = {...state, path, geometry};
        projectedPaths.set(projection, cached);
      }
      ctx.stroke(cached.path);
    } else {
      // Canvas-like contexts without Path2D can still use D3's streamed path.
      ctx.beginPath();
      geoPath(projection, ctx)(geometry);
      ctx.stroke();
    }
  } finally {
    ctx.restore();
  }
}
