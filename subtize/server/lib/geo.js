import { db } from '../db/index.js';

/** Great-circle distance in km. Good to a few metres at city scale. */
export function distanceKm(a, b) {
  if (![a?.lat, a?.lng, b?.lat, b?.lng].every((n) => Number.isFinite(Number(n)))) return null;
  const R = 6371;
  const rad = (d) => (Number(d) * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const allLocations = () => db.prepare('SELECT area, city, lat, lng FROM locations ORDER BY city, area').all();

/** Finds a known area by name, loosely: "rajpur rd" still matches "Rajpur Road". */
export function findLocation(text) {
  const needle = String(text || '').toLowerCase().replace(/\brd\b/g, 'road').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!needle) return null;
  const rows = allLocations();
  return rows.find((r) => r.area.toLowerCase() === needle)
    || rows.find((r) => needle.includes(r.area.toLowerCase()))
    || rows.find((r) => r.area.toLowerCase().includes(needle))
    || rows.find((r) => r.city.toLowerCase() === needle)
    || null;
}

export function cityCentre(city) {
  const row = db.prepare('SELECT AVG(lat) AS lat, AVG(lng) AS lng FROM locations WHERE lower(city) = lower(?)').get(city);
  return row?.lat ? { lat: row.lat, lng: row.lng } : null;
}
