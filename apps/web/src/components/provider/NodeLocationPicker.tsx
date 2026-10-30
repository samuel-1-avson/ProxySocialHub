'use client';

import { useMemo, useState } from 'react';
import { Loader2, LocateFixed } from 'lucide-react';
import {
    hubCountryCodes, nearestHubWorldwide, normalizeCountryCode, regionalHubsForCountry,
} from '@/lib/geo/regional-hubs';

export interface NodeLocation {
    country: string;
    city: string;
}

const selectClass =
    'w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-primary/50 transition-colors';

function countryName(code: string): string {
    try {
        return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
    } catch {
        return code;
    }
}

function geoErrorMessage(err: GeolocationPositionError): string {
    if (err.code === err.PERMISSION_DENIED) return 'Location permission was blocked. Pick your city from the list.';
    if (err.code === err.TIMEOUT) return 'Finding your location took too long. Try again or pick your city.';
    return "Couldn't find your location. Pick your city from the list.";
}

/**
 * Country + city picker for a provider node's map pin. "Use my location" reads the
 * device position once, in the browser, and snaps it to the nearest known city;
 * the coordinates themselves are never sent anywhere.
 */
export function NodeLocationPicker({
    value,
    onChange,
}: {
    value: NodeLocation;
    onChange: (next: NodeLocation) => void;
}) {
    const [locating, setLocating] = useState(false);
    const [note, setNote] = useState<string | null>(null);

    const country = normalizeCountryCode(value.country);
    const countries = useMemo(() => {
        const codes = hubCountryCodes();
        return country && !codes.includes(country) ? [country, ...codes] : codes;
    }, [country]);
    const cities = regionalHubsForCountry(country).map((h) => h.name);
    if (value.city && !cities.includes(value.city)) cities.unshift(value.city);

    function locateMe() {
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
            setNote("This browser can't share its location. Pick your city from the list.");
            return;
        }
        setLocating(true);
        setNote(null);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setLocating(false);
                const nearest = nearestHubWorldwide(pos.coords.latitude, pos.coords.longitude);
                if (!nearest) {
                    setNote('No known city nearby. Pick one from the list.');
                    return;
                }
                onChange({ country: nearest.country, city: nearest.hub.name });
                const km = Math.round(nearest.km);
                setNote(
                    km > 150
                        ? `Closest city we know is ${nearest.hub.name} (${km} km away). Change it if that's wrong.`
                        : `Nearest city: ${nearest.hub.name} (about ${km} km away).`,
                );
            },
            (err) => {
                setLocating(false);
                setNote(geoErrorMessage(err));
            },
            { enableHighAccuracy: false, timeout: 15_000, maximumAge: 300_000 },
        );
    }

    return (
        <div className="space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                    <label className="text-xs font-mono text-muted-foreground block mb-1.5">
                        Country
                    </label>
                    <select
                        aria-label="Country"
                        value={country}
                        onChange={(e) => onChange({ country: e.target.value, city: '' })}
                        className={selectClass}
                    >
                        <option value="">Choose a country</option>
                        {countries.map((code) => (
                            <option key={code} value={code}>
                                {countryName(code)}
                            </option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="text-xs font-mono text-muted-foreground block mb-1.5">
                        City
                    </label>
                    <select
                        aria-label="City"
                        value={value.city}
                        onChange={(e) => onChange({ country, city: e.target.value })}
                        disabled={!country}
                        className={`${selectClass} disabled:opacity-50`}
                    >
                        <option value="">{cities.length ? 'Choose a city' : 'No cities listed'}</option>
                        {cities.map((name) => (
                            <option key={name} value={name}>
                                {name}
                            </option>
                        ))}
                    </select>
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
                <button
                    type="button"
                    onClick={locateMe}
                    disabled={locating}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary hover:bg-secondary text-xs font-mono disabled:opacity-50"
                >
                    {locating ? <Loader2 size={12} className="animate-spin" /> : <LocateFixed size={12} />}
                    Use my location
                </button>
                <p aria-live="polite" className="text-xs font-mono text-muted-foreground">
                    {note}
                </p>
            </div>
            <p className="text-xs font-mono text-muted-foreground/70">
                Your exact position stays in this browser. Only the city is saved and shown on the public map.
            </p>
        </div>
    );
}
