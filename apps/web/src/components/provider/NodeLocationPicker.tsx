'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Loader2, LocateFixed } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { apiGet } from '@/lib/api/client';
import { CountrySelect } from '@/components/ui/CountrySelect';
import { PRIVACY_SETTINGS_HREF } from '@/components/marketplace/MapVisibilityNotice';
import { nearestHubWorldwide, regionalHubsForCountry } from '@/lib/geo/regional-hubs';

export interface NodeLocation {
    country: string;
    city: string;
}

type MapPrivacy = { map_visible: boolean; map_precision: 'country' | 'city' };

function countryLabel(code: string): string {
    try {
        return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
    } catch {
        return code;
    }
}

function geoErrorMessage(err: GeolocationPositionError): string {
    if (err.code === err.PERMISSION_DENIED) return 'Location permission was blocked. Type or pick your city.';
    if (err.code === err.TIMEOUT) return 'Finding your location took too long. Try again or type your city.';
    return "Couldn't find your location. Type or pick your city.";
}

/** Matches a typed city to a known one regardless of case ("kumasi" → "Kumasi"). */
function knownCity(cities: string[], typed: string): string | undefined {
    const key = typed.trim().toLowerCase();
    return cities.find((name) => name.toLowerCase() === key);
}

/**
 * What the public map will actually show for this node. Map precision is a
 * privacy setting (country area by default), and with it the map pins the
 * middle of the country whatever city is saved here, which looked like the
 * map getting the location wrong.
 */
function MapPrecisionNote({ location }: { location: NodeLocation }) {
    const { user } = useAuth();
    const privacy = useQuery({
        queryKey: ['privacy', user?.id],
        queryFn: () => apiGet<MapPrivacy>('/v1/profile/privacy'),
        enabled: !!user,
        staleTime: 30_000,
        retry: false,
    });
    if (!privacy.data) return null;
    const place = location.country ? countryLabel(location.country) : 'your country';
    const settings = (
        <Link className="ui-link" href={PRIVACY_SETTINGS_HREF}>
            privacy settings
        </Link>
    );
    if (!privacy.data.map_visible) {
        return (
            <p className="ui-note" data-testid="node-map-precision-note">
                Your nodes are hidden from the public map. You can show them in {settings}.
            </p>
        );
    }
    if (privacy.data.map_precision !== 'city') {
        return (
            <p className="ui-note" data-testid="node-map-precision-note">
                The public map shows your nodes by country only, so the pin sits in the middle of {place}
                {location.city ? `, not at ${location.city}` : ''}. To show the city area instead, change map
                precision in {settings}.
            </p>
        );
    }
    return (
        <p className="ui-note" data-testid="node-map-precision-note">
            The public map shows {location.city ? `the ${location.city} area` : `the ${place} area`}.
        </p>
    );
}

/**
 * Country and city fields for a provider node's location. Known cities come
 * from the same regional hub list the map uses, so picking one gives an exact
 * city-area pin; any other name is kept and the map shows the country area.
 * "Use my location" reads the device position once, in the browser, and only
 * the nearest known city is filled in; the coordinates are never sent.
 */
export function NodeLocationFields({
    value,
    onChange,
    disabled = false,
}: {
    value: NodeLocation;
    onChange: (next: NodeLocation) => void;
    disabled?: boolean;
}) {
    const id = useId();
    const [locating, setLocating] = useState(false);
    const [note, setNote] = useState<string | null>(null);
    const cities = regionalHubsForCountry(value.country).map((h) => h.name);

    function locateMe() {
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
            setNote("This browser can't share its location. Type or pick your city.");
            return;
        }
        setLocating(true);
        setNote(null);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setLocating(false);
                const nearest = nearestHubWorldwide(pos.coords.latitude, pos.coords.longitude);
                if (!nearest) {
                    setNote('No known city nearby. Type your city instead.');
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

    const typedKnown = value.city ? knownCity(cities, value.city) : undefined;
    return (
        <>
            <div className="ui-field">
                <span>Country</span>
                <CountrySelect
                    value={value.country}
                    onChange={(country) => onChange({ country, city: country === value.country ? value.city : '' })}
                    disabled={disabled}
                />
            </div>
            <label className="ui-field">
                City
                <input
                    className="ui-input"
                    maxLength={100}
                    list={`${id}-cities`}
                    value={value.city}
                    disabled={disabled}
                    onChange={(e) => onChange({ country: value.country, city: e.target.value })}
                    onBlur={() => {
                        if (typedKnown && typedKnown !== value.city) onChange({ country: value.country, city: typedKnown });
                    }}
                    placeholder={cities.length ? `e.g. ${cities[0]}` : 'Optional'}
                    aria-describedby={`${id}-city-help`}
                />
                <datalist id={`${id}-cities`}>
                    {cities.map((name) => (
                        <option key={name} value={name} />
                    ))}
                </datalist>
                <small id={`${id}-city-help`}>
                    {value.city && cities.length && !typedKnown
                        ? `${value.city} is not on our city list yet, so the map shows the country area. Pick the nearest listed city for a city-area pin.`
                        : cities.length
                          ? 'Pick from the list for an exact city-area pin.'
                          : 'Optional. The map shows the country area.'}
                </small>
            </label>
            <div className="ui-field">
                <span>Find it for me</span>
                <div className="flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        onClick={locateMe}
                        disabled={disabled || locating}
                        className="ui-button secondary"
                    >
                        {locating ? <Loader2 size={14} className="animate-spin" /> : <LocateFixed size={14} />}
                        Use my location
                    </button>
                    <p aria-live="polite" className="ui-note">
                        {note}
                    </p>
                </div>
                <small>Your exact position stays in this browser. Only the city is saved.</small>
            </div>
            <div className="ui-field">
                <MapPrecisionNote location={value} />
            </div>
        </>
    );
}
