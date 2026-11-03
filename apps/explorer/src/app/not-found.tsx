import Link from 'next/link';
import { BrandSymbol } from './SiteIcons';

export default function NotFound() {
  return <main id="main-content" className="explorer-not-found" tabIndex={-1}>
    <Link href="/" className="ph-brand"><span className="ph-brand-mark"><BrandSymbol /></span><span className="ph-brand-name">ProxyHubb</span>{' '}<span className="ph-product-label">Explorer</span></Link>
    <p className="ui-eyebrow">404 · Page not found</p>
    <h1>This route ends here.</h1>
    <p>The page may have moved. Return to the network overview or look up a public record.</p>
    <div className="ui-actions"><Link href="/" className="ph-primary-link">Network overview</Link><Link href="/search" className="ph-subtle-link">Find a record →</Link></div>
  </main>;
}
