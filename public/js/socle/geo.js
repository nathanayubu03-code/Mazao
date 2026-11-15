// Calculs géographiques (repris de la version précédente). Coordonnées GeoJSON [lng, lat].
const R = 6378137, rad = (d) => d * Math.PI / 180;
export function ringAreaHa(ring) {
  if (!ring || ring.length < 4) return 0;
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) { const [x1, y1] = ring[i], [x2, y2] = ring[i + 1]; a += rad(x2 - x1) * (2 + Math.sin(rad(y1)) + Math.sin(rad(y2))); }
  return Math.abs(a * R * R / 2) / 10000;
}
export function closeRing(pts) { const r = pts.map(p => [+p[0].toFixed(6), +p[1].toFixed(6)]); if (r.length) r.push(r[0].slice()); return r; }
// Polygone auto-sécant : les points ne suivent pas le contour
export function selfIntersects(pts) {
  const n = pts.length; if (n < 4) return false;
  const ccw = (A, B, C) => (C[1] - A[1]) * (B[0] - A[0]) > (B[1] - A[1]) * (C[0] - A[0]);
  const inter = (A, B, C, D) => ccw(A, C, D) !== ccw(B, C, D) && ccw(A, B, C) !== ccw(A, B, D);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
    if (inter(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
  }
  return false;
}
