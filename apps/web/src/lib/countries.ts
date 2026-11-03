/** ISO 3166-1 alpha-2 codes of every country and territory. */
const ISO_CODES =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ " +
  "BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ " +
  "DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY " +
  "HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
  "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY " +
  "MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ " +
  "NA NC NE NF NG NI NL NO NP NR NU NZ OM " +
  "PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
  "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ " +
  "TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ " +
  "UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW";

export type CountryOption = { code: string; name: string };

let cached: CountryOption[] | null = null;

/** Every country, named in English and sorted by name. */
export function listCountries(): CountryOption[] {
  if (cached) return cached;
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    names = null;
  }
  cached = ISO_CODES.split(" ")
    .filter(Boolean)
    .map((code) => {
      let name = code;
      try {
        name = names?.of(code) ?? code;
      } catch {
        name = code;
      }
      return { code, name };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
  return cached;
}

/** Lowercase text without accents, so "cote" finds "Côte d'Ivoire". */
export function foldCountryText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Countries whose name contains the text, or whose code starts with it. */
export function searchCountries(
  query: string,
  options: readonly CountryOption[] = listCountries(),
): CountryOption[] {
  const q = foldCountryText(query);
  if (!q) return [...options];
  const starts: CountryOption[] = [];
  const rest: CountryOption[] = [];
  for (const option of options) {
    const name = foldCountryText(option.name);
    if (option.code.toLowerCase() === q || name.startsWith(q)) starts.push(option);
    else if (name.includes(q) || option.code.toLowerCase().startsWith(q))
      rest.push(option);
  }
  return [...starts, ...rest];
}

/** The country a typed value means: an exact name or a two-letter code. */
export function matchCountry(
  value: string,
  options: readonly CountryOption[] = listCountries(),
): CountryOption | undefined {
  const q = foldCountryText(value);
  if (!q) return undefined;
  return options.find(
    (option) =>
      option.code.toLowerCase() === q || foldCountryText(option.name) === q,
  );
}
