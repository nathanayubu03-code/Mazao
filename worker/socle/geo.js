// Calculs géographiques côté serveur (mêmes formules que l'application agent).
// Coordonnées GeoJSON : [longitude, latitude].
const R = 6378137, rad = (d) => d * Math.PI / 180;

export function ringAreaHa(ring) {
  if (!ring || ring.length < 4) return 0;
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
    a += rad(x2 - x1) * (2 + Math.sin(rad(y1)) + Math.sin(rad(y2)));
  }
  return Math.abs(a * R * R / 2) / 10000;
}

const isLng = (v) => typeof v === 'number' && v >= 12 && v <= 32;   // RDC
const isLat = (v) => typeof v === 'number' && v >= -14 && v <= 6;

// Valide une géométrie de parcelle. Renvoie { geometry, areaHa } ou une erreur texte.
export function checkGeometry(type, g) {
  if (type === 'point') {
    if (!g || g.type !== 'Point' || !Array.isArray(g.coordinates) || !isLng(g.coordinates[0]) || !isLat(g.coordinates[1])) return { error: 'Point GPS invalide' };
    return { geometry: { type: 'Point', coordinates: g.coordinates.map(v => +v.toFixed(6)) }, areaHa: null };
  }
  if (type === 'polygon') {
    const ring = g?.type === 'Polygon' ? g.coordinates?.[0] : null;
    if (!Array.isArray(ring) || ring.length < 5) return { error: 'Polygone invalide : 4 sommets minimum' };
    if (!ring.every(p => Array.isArray(p) && isLng(p[0]) && isLat(p[1]))) return { error: 'Coordonnées hors de la RDC' };
    const first = ring[0], last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) return { error: 'Le polygone doit être fermé' };
    const clean = ring.map(p => [+p[0].toFixed(6), +p[1].toFixed(6)]);
    return { geometry: { type: 'Polygon', coordinates: [clean] }, areaHa: Math.round(ringAreaHa(clean) * 100) / 100 };
  }
  return { error: 'Type de géométrie inconnu' };
}

// Rectangle légèrement irrégulier de w x h mètres autour d'un centre (données de démonstration)
export function demoPolygon(lat, lng, w, h) {
  const mLat = 111320, mLng = 111320 * Math.cos(rad(lat));
  const pts = [[-.5, -.5], [.55, -.45], [.5, .5], [-.45, .55]].map(([x, y]) => [+(lng + x * w / mLng).toFixed(6), +(lat + y * h / mLat).toFixed(6)]);
  pts.push(pts[0].slice());
  return { type: 'Polygon', coordinates: [pts] };
}
