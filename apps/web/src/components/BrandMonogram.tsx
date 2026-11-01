/** Decorative PH mark, drawn as paths so the spoken brand stays its readable name. */
export function BrandMonogram() {
  return (
    <svg width="17" height="13" viewBox="0 0 22 18" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M2 16V2H7a4 4 0 0 1 0 8H2M14 2V16M21 2V16M14 9H21"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="square"
        strokeLinejoin="round"
      />
    </svg>
  );
}
