const R = 6371000; // Earth radius in metres

function toRad(deg) { return deg * Math.PI / 180; }

export function haversineMetres(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Points within a circle defined by {lat, lng, radiusM}
export function filterPointsInCircle(points, center, radiusM) {
  return points.filter(p =>
    p.lat != null && p.lng != null &&
    haversineMetres(p.lat, p.lng, center.lat, center.lng) <= radiusM
  );
}

// Ray-casting point-in-polygon
// ring: array of {lat, lng} — must have at least 3 points
export function filterPointsInPolygon(points, ring) {
  if (!ring || ring.length < 3) return [];
  return points.filter(p => p.lat != null && p.lng != null && pointInPolygon(p.lat, p.lng, ring));
}

function pointInPolygon(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lng, yi = ring[i].lat;
    const xj = ring[j].lng, yj = ring[j].lat;
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
