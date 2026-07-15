package geo

import "strings"

// NormalizeProviderLocation normalizes country codes and canonical regional hub names.
// City is left empty when unknown so IP enrichment can snap to the nearest hub.
func NormalizeProviderLocation(country, city string) (string, string) {
	country = strings.TrimSpace(country)
	city = strings.TrimSpace(city)
	if isUnknownPlace(city) {
		city = ""
	}
	if isUnknownPlace(country) {
		country = ""
	}

	country = NormalizeCountryCode(country)
	if city != "" {
		if hubCity, _, _, ok := ApplyRegionalHubCoords(country, city, "", 0, 0); ok {
			city = hubCity
		}
	}
	return country, city
}

func isUnknownPlace(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "", "unknown", "n/a", "na", "—", "-":
		return true
	default:
		return false
	}
}

// NormalizeCountryCode returns a strict ISO-3166 alpha-2 country code for known
// full names, ISO-3 codes, and alpha-2 codes. Unknown free-form names return "".
func NormalizeCountryCode(country string) string {
	return normalizeCountryKey(country)
}

func normalizeCountryKey(country string) string {
	c := strings.TrimSpace(country)
	if c == "" {
		return ""
	}
	upper := strings.ToUpper(c)
	switch upper {
	case "GH", "GHA", "GHANA":
		return "GH"
	case "US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA":
		return "US"
	case "GB", "UK", "UNITED KINGDOM", "GREAT BRITAIN":
		return "GB"
	case "NG", "NGA", "NIGERIA":
		return "NG"
	case "CN", "CHN", "CHINA", "PEOPLE'S REPUBLIC OF CHINA", "PRC":
		return "CN"
	case "IN", "IND", "INDIA":
		return "IN"
	case "DE", "DEU", "GERMANY":
		return "DE"
	case "FR", "FRA", "FRANCE":
		return "FR"
	case "ES", "ESP", "SPAIN":
		return "ES"
	case "IT", "ITA", "ITALY":
		return "IT"
	case "NL", "NLD", "NETHERLANDS", "THE NETHERLANDS":
		return "NL"
	case "BE", "BEL", "BELGIUM":
		return "BE"
	case "CH", "CHE", "SWITZERLAND":
		return "CH"
	case "PL", "POL", "POLAND":
		return "PL"
	case "SE", "SWE", "SWEDEN":
		return "SE"
	case "NO", "NOR", "NORWAY":
		return "NO"
	case "AT", "AUT", "AUSTRIA":
		return "AT"
	case "PT", "PRT", "PORTUGAL":
		return "PT"
	case "IE", "IRL", "IRELAND":
		return "IE"
	case "RO", "ROU", "ROMANIA":
		return "RO"
	case "CZ", "CZE", "CZECH REPUBLIC", "CZECHIA":
		return "CZ"
	case "GR", "GRC", "GREECE":
		return "GR"
	case "TR", "TUR", "TURKEY", "TÜRKIYE", "TURKIYE":
		return "TR"
	case "RU", "RUS", "RUSSIA", "RUSSIAN FEDERATION":
		return "RU"
	case "JP", "JPN", "JAPAN":
		return "JP"
	case "KR", "KOR", "SOUTH KOREA", "KOREA, REPUBLIC OF", "REPUBLIC OF KOREA":
		return "KR"
	case "SG", "SGP", "SINGAPORE":
		return "SG"
	case "AU", "AUS", "AUSTRALIA":
		return "AU"
	case "BR", "BRA", "BRAZIL":
		return "BR"
	case "MX", "MEX", "MEXICO":
		return "MX"
	case "CA", "CAN", "CANADA":
		return "CA"
	case "ZA", "ZAF", "SOUTH AFRICA":
		return "ZA"
	case "EG", "EGY", "EGYPT":
		return "EG"
	case "KE", "KEN", "KENYA":
		return "KE"
	case "AE", "ARE", "UAE", "UNITED ARAB EMIRATES":
		return "AE"
	default:
		if len(upper) == 2 {
			return upper
		}
		return ""
	}
}
