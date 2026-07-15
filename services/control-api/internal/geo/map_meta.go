package geo

// MapGeoMeta describes how map coordinates were derived (attached to API map points).
type MapGeoMeta struct {
	Source       string `json:"source"`
	DisplayLabel string `json:"display_label"`
	Estimated    bool   `json:"estimated"`
}

// BuildMapGeoMeta builds display metadata for a resolved geo_source value.
func BuildMapGeoMeta(source string) MapGeoMeta {
	estimated := source == "region_hub" || source == "city_centroid" || source == "country_centroid" || source == "unknown"
	return MapGeoMeta{
		Source:       source,
		DisplayLabel: MapGeoDisplayLabel(source, estimated),
		Estimated:    estimated,
	}
}

// MapGeoDisplayLabel returns a human-readable precision label for map UI.
func MapGeoDisplayLabel(source string, estimated bool) string {
	switch source {
	case "region_hub":
		return "Regional hub (approx.)"
	case "city_centroid":
		return "City area (approx.)"
	case "country_centroid":
		return "Country area (approx.)"
	case "explorer", "gps", "gateway", "provider":
		return "Regional area"
	default:
		if estimated {
			return "Approximate location"
		}
		return "Regional area"
	}
}
