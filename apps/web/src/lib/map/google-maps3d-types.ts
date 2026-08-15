/**
 * Minimal typings for google.maps.maps3d (not always present in @types/google.maps).
 */

export type Maps3DAltitudeMode = 'ABSOLUTE' | 'RELATIVE_TO_GROUND' | 'CLAMP_TO_GROUND';

export type Maps3DLatLngAltitude = {
    lat: number;
    lng: number;
    altitude?: number;
};

export type Maps3DCameraOptions = {
    center?: Maps3DLatLngAltitude;
    range?: number;
    heading?: number;
    tilt?: number;
    roll?: number;
};

export type Maps3DMapElement = HTMLElement & {
    mode: string;
    center: Maps3DLatLngAltitude;
    range: number;
    heading: number;
    tilt: number;
    flyCameraTo: (opts: Maps3DCameraOptions & { durationMillis?: number }) => void;
    flyCameraAround: (opts: Maps3DCameraOptions & { durationMillis?: number; rounds?: number }) => void;
};

export type Maps3DMarkerElement = HTMLElement & {
    position: Maps3DLatLngAltitude;
    altitudeMode: Maps3DAltitudeMode;
    extruded?: boolean;
    label?: string;
    drawsWhenOccluded?: boolean;
};

export interface Maps3DLibrary {
    Map3DElement: new (opts?: {
        center?: Maps3DLatLngAltitude;
        range?: number;
        heading?: number;
        tilt?: number;
        mode?: string;
        defaultUIDisabled?: boolean;
    }) => Maps3DMapElement;
    MapMode: { HYBRID: string; SATELLITE: string; ROADMAP?: string };
    Marker3DInteractiveElement: new (opts?: {
        position?: Maps3DLatLngAltitude;
        altitudeMode?: Maps3DAltitudeMode;
        extruded?: boolean;
        label?: string;
        title?: string;
        drawsWhenOccluded?: boolean;
    }) => Maps3DMarkerElement;
    AltitudeMode: {
        ABSOLUTE: Maps3DAltitudeMode;
        RELATIVE_TO_GROUND: Maps3DAltitudeMode;
        CLAMP_TO_GROUND: Maps3DAltitudeMode;
    };
}

export type MarkerPinElement = HTMLElement & {
    background: string;
    borderColor: string;
    glyphColor: string;
    scale: number;
};

export interface MarkerLibraryLoose {
    PinElement: new (opts?: {
        background?: string;
        borderColor?: string;
        glyphColor?: string;
        scale?: number;
        glyph?: string | HTMLElement | URL;
    }) => MarkerPinElement;
}
