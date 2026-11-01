"use client";
import dynamic from "next/dynamic";
export const LazyBuyListingModal = dynamic(
  () =>
    import("@/components/BuyListingModal").then(
      (module) => module.BuyListingModal,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="checkout-loading" role="status" aria-live="polite">
        Opening secure purchase review…
      </div>
    ),
  },
);
