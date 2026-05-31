export interface MapBBox {
    west: number;
    south: number;
    east: number;
    north: number;
}

export function bboxToParam(b: MapBBox): string {
    return `${b.west},${b.south},${b.east},${b.north}`;
}

export function pinInBBox(lat: number, lon: number, b: MapBBox): boolean {
    return lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north;
}

const BBOX_EPS = 0.02;

export function bboxNearlyEqual(a: MapBBox, b: MapBBox): boolean {
    return (
        Math.abs(a.west - b.west) < BBOX_EPS &&
        Math.abs(a.south - b.south) < BBOX_EPS &&
        Math.abs(a.east - b.east) < BBOX_EPS &&
        Math.abs(a.north - b.north) < BBOX_EPS
    );
}
