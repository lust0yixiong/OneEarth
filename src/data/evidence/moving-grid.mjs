// Coarse overview mesh during rotation. Project each shared vertex once per frame.
const prepared = new WeakMap();
function prepare(mesh) {
  const byPoint = new Map(), vectors = [], edges = [];
  function vertex(point) {
    const key = point.join(',');
    if (byPoint.has(key)) return byPoint.get(key);
    const lon = point[0] * Math.PI / 180, lat = point[1] * Math.PI / 180;
    const index = vectors.length / 3;
    vectors.push(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
    byPoint.set(key, index);
    return index;
  }
  for (const [a,b] of mesh.coordinates) edges.push(vertex(a), vertex(b));
  const result = {vectors: Float64Array.from(vectors), edges: Uint32Array.from(edges), screen: new Float64Array(vectors.length)};
  prepared.set(mesh, result);
  return result;
}

export function strokeMovingGrid(ctx, projection, mesh, camera) {
  const {vectors, edges, screen} = prepared.get(mesh) || prepare(mesh);
  const lon = camera[0] * Math.PI / 180, lat = camera[1] * Math.PI / 180;
  const cosLon = Math.cos(lon), sinLon = Math.sin(lon), cosLat = Math.cos(lat), sinLat = Math.sin(lat);
  const [cx,cy] = projection.translate(), radius = projection.scale();
  for (let i = 0; i < vectors.length; i += 3) {
    const x = vectors[i], y = vectors[i+1], z = vectors[i+2];
    const horizontal = x*cosLon + y*sinLon;
    screen[i] = cx + radius*(y*cosLon - x*sinLon);
    screen[i+1] = cy - radius*(z*cosLat - horizontal*sinLat);
    screen[i+2] = horizontal*cosLat + z*sinLat;
  }
  ctx.beginPath();
  for (let i = 0; i < edges.length; i += 2) {
    const a = edges[i]*3, b = edges[i+1]*3;
    const da = screen[a+2], db = screen[b+2];
    if (da < 0 && db < 0) continue;
    let ax=screen[a], ay=screen[a+1], bx=screen[b], by=screen[b+1];
    if (da < 0 || db < 0) {
      const t=da/(da-db), x=ax+(bx-ax)*t, y=ay+(by-ay)*t;
      if (da < 0) { ax=x; ay=y; } else { bx=x; by=y; }
    }
    ctx.moveTo(ax,ay);
    ctx.lineTo(bx,by);
  }
  ctx.stroke();
}
