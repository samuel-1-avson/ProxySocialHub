import type { ReactNode } from "react";
import { ComingSoonBanner } from "@/components/ComingSoonBanner";

export default function ComingSoonLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ComingSoonBanner feature="The agent console" />
      {children}
    </>
  );
}
