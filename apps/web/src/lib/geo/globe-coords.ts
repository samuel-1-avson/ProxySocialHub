/** True when lat/lon are finite and within WGS84 bounds (H3 / three-globe safe). */
export function isValidGlobeCoord(lat: number, lon: number): boolean {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
    if (Math.abs(lat) < 0.01 && Math.abs(lon) < 0.01) return false;
    return true;
}
