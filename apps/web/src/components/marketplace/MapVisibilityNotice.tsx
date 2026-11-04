"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiGet, apiPut } from "@/lib/api/client";
import { getMyListings, marketplaceKeys } from "@/lib/api/marketplace";
import { DataError } from "@/components/workspace/Patterns";

type MapPrivacy = { map_visible: boolean; map_precision: "country" | "city" };

export const PRIVACY_SETTINGS_HREF = "/app/settings?tab=privacy";

/** Same key as Settings > Privacy, so both views share one cached record. */
const privacyKey = (userId?: string) => ["privacy", userId] as const;

function precisionLabel(precision: MapPrivacy["map_precision"] | undefined) {
  return precision === "city" ? "approximate city area" : "country area";
}

/**
 * Map visibility is opt-in (profiles.map_visible defaults to false), and the
 * public map leaves out every listing and node of a seller who has not opted
 * in. Tell a seller when that is why their offers are missing from the map.
 *
 * Pass `hasListings` when the caller already knows; leave it out to have the
 * notice check the signed-in user's own listings itself.
 */
export function MapVisibilityNotice({ hasListings }: { hasListings?: boolean }) {
  const { user } = useAuth();
  const client = useQueryClient();
  const probe = useQuery({
    queryKey: [...marketplaceKeys.myListings(1), "map-visibility", user?.id],
    queryFn: () => getMyListings(1, 1),
    enabled: !!user && hasListings === undefined,
    staleTime: 60_000,
    retry: false,
  });
  const sells =
    hasListings ??
    (probe.data?.total ?? probe.data?.listings?.length ?? 0) > 0;
  const privacy = useQuery({
    queryKey: privacyKey(user?.id),
    queryFn: () => apiGet<MapPrivacy>("/v1/profile/privacy"),
    enabled: !!user && sells,
    staleTime: 30_000,
    retry: false,
  });
  const showOnMap = useMutation({
    retry: false,
    mutationFn: () =>
      apiPut<MapPrivacy>("/v1/profile/privacy", { map_visible: true }),
    onSuccess: (data) => {
      client.setQueryData(privacyKey(user?.id), data);
      void client.invalidateQueries({ queryKey: ["privacy-preview", user?.id] });
      void client.invalidateQueries({ queryKey: marketplaceKeys.all });
    },
  });

  if (!user || !sells || !privacy.data) return null;

  if (privacy.data.map_visible) {
    if (!showOnMap.isSuccess) return null;
    return (
      <p className="ui-note" role="status" data-testid="map-visibility-notice">
        Your listings and nodes now appear on the public map at{" "}
        {precisionLabel(privacy.data.map_precision)} precision. You can change
        this in <Link className="ui-link" href={PRIVACY_SETTINGS_HREF}>privacy settings</Link>.
      </p>
    );
  }

  return (
    <section
      className="ui-attention"
      aria-labelledby="map-visibility-title"
      data-testid="map-visibility-notice"
    >
      <h2 id="map-visibility-title">Your listings are not on the map</h2>
      <p>
        Map visibility is off in your privacy settings, so buyers can find your
        offers in the list view but not on the marketplace map. Turning it on
        shows each node&apos;s {precisionLabel(privacy.data.map_precision)} and
        reported health, never an address. Buyers who use your proxy can see
        its exit IP either way.
      </p>
      <div className="ui-actions">
        <button
          type="button"
          className="ui-button"
          disabled={showOnMap.isPending}
          onClick={() => showOnMap.mutate()}
        >
          {showOnMap.isPending ? "Saving…" : "Show my listings on the map"}
        </button>
        <Link className="ui-button secondary" href={PRIVACY_SETTINGS_HREF}>
          Privacy settings
        </Link>
      </div>
      {showOnMap.isError ? (
        <DataError
          error={showOnMap.error}
          title="Map visibility was not changed"
        />
      ) : null}
    </section>
  );
}
