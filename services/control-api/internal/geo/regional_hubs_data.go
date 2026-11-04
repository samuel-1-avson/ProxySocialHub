package geo

// mkHub builds a regional map anchor with optional state/province/city aliases.
func mkHub(name string, lat, lon float64, aliases ...string) regionalHub {
	return regionalHub{Name: name, Lat: lat, Lon: lon, Aliases: aliases}
}

// regionalHubsByCountry lists major city-region anchors for map clustering worldwide.
// IP/city hints snap to the nearest hub; multiple nodes in the same hub stack on one pin.
var regionalHubsByCountry = map[string][]regionalHub{
	"GH": {
		mkHub("Accra", 5.6037, -0.1870, "greater accra", "greater accra region", "tema", "teshie", "madina", "east legon"),
		mkHub("Kumasi", 6.6885, -1.6244, "ashanti", "ashanti region", "asante"),
		mkHub("Takoradi", 4.8845, -1.7554, "sekondi", "sekondi-takoradi", "western", "western region"),
		mkHub("Bibiani", 6.4632, -2.3192, "western north", "western north region", "sefwi", "sefwi-wiawso", "wiawso", "bibiani"),
		mkHub("Cape Coast", 5.1053, -1.2466, "central", "central region"),
		mkHub("Tamale", 9.4035, -0.8429, "northern", "northern region"),
		// Remaining regional capitals, so every one of Ghana's 16 regions has a hub
		// and nodes there are not pulled to a city in another region.
		mkHub("Koforidua", 6.0941, -0.2591, "eastern", "eastern region", "new juaben"),
		mkHub("Ho", 6.6008, 0.4713, "volta", "volta region"),
		mkHub("Dambai", 8.0667, 0.1833, "oti", "oti region"),
		mkHub("Sunyani", 7.3399, -2.3268, "bono", "bono region", "brong ahafo", "brong ahafo region"),
		mkHub("Techiman", 7.5833, -1.9333, "bono east", "bono east region"),
		mkHub("Goaso", 6.8036, -2.5172, "ahafo", "ahafo region"),
		mkHub("Bolgatanga", 10.7856, -0.8514, "upper east", "upper east region", "bolga"),
		mkHub("Wa", 10.0601, -2.5099, "upper west", "upper west region"),
		mkHub("Nalerigu", 10.5272, -0.3698, "north east", "north east region"),
		mkHub("Damongo", 9.0833, -1.8167, "savannah", "savannah region"),
	},
	"US": {
		mkHub("New York", 40.7128, -74.0060, "new york", "nyc", "ny", "new york state", "brooklyn", "manhattan", "queens", "bronx", "long island", "newark", "jersey city", "new jersey", "nj", "connecticut", "ct"),
		mkHub("Los Angeles", 34.0522, -118.2437, "los angeles", "la", "hollywood", "santa monica", "pasadena", "anaheim", "inland empire", "riverside"),
		mkHub("San Francisco", 37.7749, -122.4194, "san francisco", "sf", "bay area", "san jose", "oakland", "silicon valley", "palo alto", "northern california", "sacramento"),
		mkHub("San Diego", 32.7157, -117.1611, "san diego", "southern california", "orange county", "irvine"),
		mkHub("Chicago", 41.8781, -87.6298, "chicago", "illinois", "il", "indiana", "wisconsin", "midwest"),
		mkHub("Houston", 29.7604, -95.3698, "houston", "galveston", "beaumont"),
		mkHub("Dallas", 32.7767, -96.7970, "dallas", "fort worth", "dfw", "plano", "arlington texas", "texas", "tx"),
		mkHub("Austin", 30.2672, -97.7431, "austin", "san antonio", "central texas"),
		mkHub("Phoenix", 33.4484, -112.0740, "phoenix", "arizona", "az", "scottsdale", "tucson"),
		mkHub("Atlanta", 33.7490, -84.3880, "atlanta", "georgia", "ga", "savannah"),
		mkHub("Miami", 25.7617, -80.1918, "miami", "florida", "fl", "tampa", "orlando", "jacksonville", "fort lauderdale"),
		mkHub("Seattle", 47.6062, -122.3321, "seattle", "washington", "wa", "portland", "oregon", "or", "tacoma"),
		mkHub("Denver", 39.7392, -104.9903, "denver", "colorado", "co", "utah", "ut", "rocky mountain"),
		mkHub("Boston", 42.3601, -71.0589, "boston", "massachusetts", "ma", "new england", "rhode island", "ri", "new hampshire", "nh", "vermont", "vt", "maine", "me"),
		mkHub("Washington", 38.9072, -77.0369, "washington dc", "district of columbia", "dc", "maryland", "md", "virginia", "va", "baltimore"),
		mkHub("Philadelphia", 39.9526, -75.1652, "philadelphia", "pennsylvania", "pa", "pittsburgh", "delaware", "de"),
		mkHub("Detroit", 42.3314, -83.0458, "detroit", "michigan", "mi", "cleveland", "ohio", "oh", "columbus", "cincinnati"),
		mkHub("Minneapolis", 44.9778, -93.2650, "minneapolis", "minnesota", "mn", "st paul", "wisconsin", "iowa", "ia", "north dakota", "south dakota", "nebraska", "ne", "kansas", "ks", "missouri", "mo"),
		mkHub("Charlotte", 35.2271, -80.8431, "charlotte", "north carolina", "nc", "raleigh", "south carolina", "sc", "tennessee", "tn", "nashville", "memphis", "kentucky", "ky", "louisville"),
		mkHub("Las Vegas", 36.1699, -115.1398, "las vegas", "nevada", "nv", "reno"),
		mkHub("New Orleans", 29.9511, -90.0715, "new orleans", "louisiana", "baton rouge", "alabama", "al", "mississippi", "ms", "arkansas", "ar", "oklahoma", "ok"),
	},
	"NG": {
		mkHub("Lagos", 6.5244, 3.3792, "lagos", "lagos state", "ikeja", "lekki", "victoria island"),
		mkHub("Abuja", 9.0765, 7.3986, "abuja", "fct", "federal capital territory"),
		mkHub("Kano", 12.0022, 8.5920, "kano", "kano state"),
		mkHub("Ibadan", 7.3775, 3.9470, "ibadan", "oyo", "oyo state"),
		mkHub("Port Harcourt", 4.8156, 7.0498, "port harcourt", "rivers", "rivers state", "ph"),
		mkHub("Benin City", 6.3350, 5.6037, "benin city", "edo", "edo state"),
		mkHub("Kaduna", 10.5105, 7.4165, "kaduna", "kaduna state"),
		mkHub("Enugu", 6.5244, 7.5086, "enugu", "enugu state", "south east", "southeast"),
		mkHub("Maiduguri", 11.8333, 13.1500, "maiduguri", "borno", "north east", "northeast"),
	},
	"CN": {
		mkHub("Beijing", 39.9042, 116.4074, "beijing", "peking", "beijing municipality"),
		mkHub("Shanghai", 31.2304, 121.4737, "shanghai", "shanghai municipality"),
		mkHub("Guangzhou", 23.1291, 113.2644, "guangzhou", "canton", "guangdong", "gd"),
		mkHub("Shenzhen", 22.5431, 114.0579, "shenzhen", "shen zhen"),
		mkHub("Chengdu", 30.5728, 104.0668, "chengdu", "sichuan", "sc"),
		mkHub("Hangzhou", 30.2741, 120.1551, "hangzhou", "zhejiang", "zj"),
		mkHub("Wuhan", 30.5928, 114.3055, "wuhan", "hubei", "hb"),
		mkHub("Xi'an", 34.3416, 108.9398, "xian", "xi an", "shaanxi", "sn"),
		mkHub("Nanjing", 32.0603, 118.7969, "nanjing", "jiangsu", "js"),
		mkHub("Tianjin", 39.3434, 117.3616, "tianjin"),
		mkHub("Chongqing", 29.4316, 106.9123, "chongqing"),
		mkHub("Suzhou", 31.2989, 120.5853, "suzhou"),
	},
	"IN": {
		mkHub("Mumbai", 19.0760, 72.8777, "mumbai", "bombay", "maharashtra"),
		mkHub("Delhi", 28.7041, 77.1025, "delhi", "new delhi", "ncr"),
		mkHub("Bengaluru", 12.9716, 77.5946, "bengaluru", "bangalore", "karnataka"),
		mkHub("Hyderabad", 17.3850, 78.4867, "hyderabad", "telangana"),
		mkHub("Chennai", 13.0827, 80.2707, "chennai", "madras", "tamil nadu"),
		mkHub("Kolkata", 22.5726, 88.3639, "kolkata", "calcutta", "west bengal"),
		mkHub("Pune", 18.5204, 73.8567, "pune"),
		mkHub("Ahmedabad", 23.0225, 72.5714, "ahmedabad", "gujarat"),
	},
	"GB": {
		mkHub("London", 51.5074, -0.1278, "london", "greater london", "england", "south east", "south east england"),
		mkHub("Manchester", 53.4808, -2.2426, "manchester", "north west", "north west england", "liverpool", "leeds"),
		mkHub("Birmingham", 52.4862, -1.8904, "birmingham", "west midlands", "coventry"),
		mkHub("Edinburgh", 55.9533, -3.1883, "edinburgh", "scotland", "glasgow"),
		mkHub("Bristol", 51.4545, -2.5879, "bristol", "south west", "south west england", "cardiff", "wales"),
		mkHub("Newcastle", 54.9783, -1.6178, "newcastle", "north east", "north east england", "sunderland"),
	},
	"DE": {
		mkHub("Berlin", 52.5200, 13.4050, "berlin", "brandenburg"),
		mkHub("Munich", 48.1351, 11.5820, "munich", "münchen", "bavaria", "bayern"),
		mkHub("Hamburg", 53.5511, 9.9937, "hamburg", "bremen", "schleswig-holstein"),
		mkHub("Frankfurt", 50.1109, 8.6821, "frankfurt", "hesse", "hessen", "wiesbaden"),
		mkHub("Cologne", 50.9375, 6.9603, "cologne", "köln", "koln", "north rhine-westphalia", "nrw", "düsseldorf", "dusseldorf", "dortmund"),
		mkHub("Stuttgart", 48.7758, 9.1829, "stuttgart", "baden-württemberg", "baden wurttemberg"),
	},
	"FR": {
		mkHub("Paris", 48.8566, 2.3522, "paris", "île-de-france", "ile de france", "idf"),
		mkHub("Lyon", 45.7640, 4.8357, "lyon", "auvergne-rhône-alpes", "rhone alpes"),
		mkHub("Marseille", 43.2965, 5.3698, "marseille", "provence", "paca", "nice", "toulon"),
		mkHub("Toulouse", 43.6047, 1.4442, "toulouse", "occitanie", "montpellier"),
		mkHub("Bordeaux", 44.8378, -0.5792, "bordeaux", "nouvelle-aquitaine", "nantes", "rennes"),
	},
	"ES": {
		mkHub("Madrid", 40.4168, -3.7038, "madrid", "community of madrid"),
		mkHub("Barcelona", 41.3851, 2.1734, "barcelona", "catalonia", "cataluña"),
		mkHub("Valencia", 39.4699, -0.3763, "valencia", "valencian community"),
		mkHub("Seville", 37.3891, -5.9845, "seville", "sevilla", "andalusia", "andalucía"),
	},
	"IT": {
		mkHub("Rome", 41.9028, 12.4964, "rome", "roma", "lazio"),
		mkHub("Milan", 45.4642, 9.1900, "milan", "milano", "lombardy", "lombardia"),
		mkHub("Naples", 40.8518, 14.2681, "naples", "napoli", "campania"),
		mkHub("Turin", 45.0703, 7.6869, "turin", "torino", "piedmont"),
	},
	"NL": {
		mkHub("Amsterdam", 52.3676, 4.9041, "amsterdam", "north holland", "noord-holland"),
		mkHub("Rotterdam", 51.9244, 4.4777, "rotterdam", "the hague", "den haag", "south holland"),
	},
	"BE": {
		mkHub("Brussels", 50.8503, 4.3517, "brussels", "bruxelles", "brussels-capital", "antwerp", "antwerpen", "ghent"),
	},
	"CH": {
		mkHub("Zurich", 47.3769, 8.5417, "zurich", "zürich", "bern", "basel", "geneva", "genève"),
	},
	"PL": {
		mkHub("Warsaw", 52.2297, 21.0122, "warsaw", "warszawa", "masovian"),
		mkHub("Krakow", 50.0647, 19.9450, "krakow", "kraków", "wroclaw", "wrocław", "gdansk", "gdańsk"),
	},
	"SE": {
		mkHub("Stockholm", 59.3293, 18.0686, "stockholm", "sweden"),
		mkHub("Gothenburg", 57.7089, 11.9746, "gothenburg", "göteborg", "malmo", "malmö"),
	},
	"NO": {
		mkHub("Oslo", 59.9139, 10.7522, "oslo", "norway", "bergen"),
	},
	"AT": {
		mkHub("Vienna", 48.2082, 16.3738, "vienna", "wien", "austria", "salzburg", "graz"),
	},
	"PT": {
		mkHub("Lisbon", 38.7223, -9.1393, "lisbon", "lisboa", "porto"),
	},
	"IE": {
		mkHub("Dublin", 53.3498, -6.2603, "dublin", "ireland", "cork"),
	},
	"RO": {
		mkHub("Bucharest", 44.4268, 26.1025, "bucharest", "bucurești", "romania"),
	},
	"CZ": {
		mkHub("Prague", 50.0755, 14.4378, "prague", "praha", "czech republic", "czechia"),
	},
	"GR": {
		mkHub("Athens", 37.9838, 23.7275, "athens", "attica", "greece", "thessaloniki"),
	},
	"TR": {
		mkHub("Istanbul", 41.0082, 28.9784, "istanbul", "turkey", "türkiye", "bursa"),
		mkHub("Ankara", 39.9334, 32.8597, "ankara"),
	},
	"RU": {
		mkHub("Moscow", 55.7558, 37.6173, "moscow", "moskva", "russia"),
		mkHub("Saint Petersburg", 59.9311, 30.3609, "saint petersburg", "st petersburg", "st. petersburg"),
	},
	"JP": {
		mkHub("Tokyo", 35.6762, 139.6503, "tokyo", "kanto", "yokohama", "chiba", "saitama"),
		mkHub("Osaka", 34.6937, 135.5023, "osaka", "kansai", "kyoto", "kobe", "nagoya"),
	},
	"KR": {
		mkHub("Seoul", 37.5665, 126.9780, "seoul", "gyeonggi", "incheon"),
		mkHub("Busan", 35.1796, 129.0756, "busan", "pusan"),
	},
	"SG": {
		mkHub("Singapore", 1.3521, 103.8198, "singapore"),
	},
	"AU": {
		mkHub("Sydney", -33.8688, 151.2093, "sydney", "new south wales", "nsw"),
		mkHub("Melbourne", -37.8136, 144.9631, "melbourne", "victoria", "vic"),
		mkHub("Brisbane", -27.4698, 153.0251, "brisbane", "queensland", "qld"),
		mkHub("Perth", -31.9505, 115.8605, "perth", "western australia", "wa"),
	},
	"BR": {
		mkHub("São Paulo", -23.5505, -46.6333, "sao paulo", "são paulo", "sp"),
		mkHub("Rio de Janeiro", -22.9068, -43.1729, "rio de janeiro", "rio", "rj"),
		mkHub("Brasília", -15.7975, -47.8919, "brasilia", "brasília", "df", "federal district"),
	},
	"MX": {
		mkHub("Mexico City", 19.4326, -99.1332, "mexico city", "ciudad de mexico", "cdmx", "df"),
		mkHub("Guadalajara", 20.6597, -103.3496, "guadalajara", "jalisco"),
		mkHub("Monterrey", 25.6866, -100.3161, "monterrey", "nuevo leon", "nuevo león"),
	},
	"CA": {
		mkHub("Toronto", 43.6532, -79.3832, "toronto", "ontario", "on", "ottawa", "mississauga"),
		mkHub("Vancouver", 49.2827, -123.1207, "vancouver", "british columbia", "bc", "victoria bc"),
		mkHub("Montreal", 45.5017, -73.5673, "montreal", "montréal", "quebec", "qc", "québec"),
		mkHub("Calgary", 51.0447, -114.0719, "calgary", "alberta", "ab", "edmonton"),
	},
	"ZA": {
		mkHub("Johannesburg", -26.2041, 28.0473, "johannesburg", "gauteng", "pretoria"),
		mkHub("Cape Town", -33.9249, 18.4241, "cape town", "western cape"),
		mkHub("Durban", -29.8587, 31.0218, "durban", "kwazulu-natal", "kzn"),
	},
	"EG": {
		mkHub("Cairo", 30.0444, 31.2357, "cairo", "giza", "egypt"),
	},
	"KE": {
		mkHub("Nairobi", -1.2921, 36.8219, "nairobi", "kenya", "mombasa"),
	},
	"AE": {
		mkHub("Dubai", 25.2048, 55.2708, "dubai", "sharjah", "ajman"),
		mkHub("Abu Dhabi", 24.4539, 54.3773, "abu dhabi", "uae", "united arab emirates"),
	},
}
