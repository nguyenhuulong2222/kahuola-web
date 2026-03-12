export function pointGeometry(lon: number, lat: number): GeoJSON.Point {
  return {
    type: "Point",
    coordinates: [lon, lat],
  };
}
