import Link from "next/link";
import { BrandMonogram } from "@/components/BrandMonogram";

interface BrandLockupProps {
  href: string;
  className?: string;
  ariaLabel?: string;
  onClick?: () => void;
}

export function BrandLockup({
  href,
  className = "",
  ariaLabel,
  onClick,
}: BrandLockupProps) {
  return (
    <Link
      href={href}
      className={`brand-lockup ${className}`.trim()}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      <span className="brand-lockup-mark" aria-hidden="true">
        <BrandMonogram />
      </span>
      <span className="brand-lockup-name">ProxyHubb</span>
    </Link>
  );
}
