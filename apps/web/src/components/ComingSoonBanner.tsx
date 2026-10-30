import { FlaskConical } from "lucide-react";

/** Marks an early-preview page listed under "Coming soon" in the menu. */
export function ComingSoonBanner({ feature }: { feature: string }) {
  return (
    <div
      role="note"
      className="mx-auto mb-6 mt-4 flex max-w-5xl items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-foreground"
    >
      <FlaskConical size={18} className="mt-0.5 shrink-0 text-warning" aria-hidden />
      <p>
        <span className="font-medium">{feature} is coming soon.</span>{" "}
        <span className="text-muted-foreground">
          This is an early preview. Some parts may not work yet.
        </span>
      </p>
    </div>
  );
}
