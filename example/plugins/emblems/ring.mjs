// A ring around a point, as map geometry. Page usage: emblem: { kind: ring, center: [lon, lat], radius_km: 20 }
// Every emblem plugin is a default export (params, { turf }) => FeatureCollection whose features carry a "color".
export default function ring({ center, radius_km: r, color = '#c62828' }, { turf }) {
  if (!Array.isArray(center) || center.length !== 2 || !(r > 0)) throw new Error('ring needs center [lon, lat] and radius_km');
  const band = turf.difference(turf.featureCollection([turf.circle(center, r, { steps: 96, units: 'kilometers' }), turf.circle(center, r * 0.8, { steps: 96, units: 'kilometers' })]));
  return turf.featureCollection([{ ...band, properties: { color } }]);
}
