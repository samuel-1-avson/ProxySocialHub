import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';

/**
 * Plain-language picture components for MDX pages.
 *
 * <Flow caption="…">
 *   <FlowStep icon="laptop" title="You">…</FlowStep>
 *   <FlowStep icon="server" title="ProxyHubb" arrow="sends your request">…</FlowStep>
 * </Flow>
 *
 * <MoneyFlow />
 *
 * <IdeaGrid>
 *   <IdeaCard icon="ticket" title="Day pass" label="Session intent">…</IdeaCard>
 * </IdeaGrid>
 */

const ICONS: Record<string, ReactNode> = {
  laptop: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M2 20h20" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  server: (
    <>
      <rect x="3" y="3" width="18" height="7" rx="1.5" />
      <rect x="3" y="14" width="18" height="7" rx="1.5" />
      <path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6" />
    </>
  ),
  house: (
    <>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v10h14V10" />
      <path d="M10 20v-6h4v6" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <path d="M16.5 14.5h.01" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  paid: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </>
  ),
  refund: (
    <>
      <path d="M4 12a8 8 0 1 0 2.3-5.7" />
      <path d="M4 4v4h4" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9M16 7l3 3" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 20h16" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
    </>
  ),
  checklist: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V3h6v1" />
      <path d="M9 13l2 2 4-4" />
    </>
  ),
  power: (
    <>
      <path d="M12 3v8" />
      <path d="M6.3 7.3a8 8 0 1 0 11.4 0" />
    </>
  ),
  signal: (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8" />
    </>
  ),
  meter: (
    <>
      <path d="M4 17a8 8 0 1 1 16 0" />
      <path d="M12 17l4-5" />
      <path d="M3 21h18" />
    </>
  ),
  office: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <path d="M9 21v-4h6v4" />
      <path d="M8 7h2M14 7h2M8 11h2M14 11h2" />
    </>
  ),
  chain: (
    <>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
    </>
  ),
  ticket: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M9 6v2M9 11v2M9 16v2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3l9 5-9 5-9-5z" />
      <path d="M3 13l9 5 9-5" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9l3 3-3 3M12 15h5" />
    </>
  ),
  report: (
    <>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M14 3v5h5M9 13h7M9 17h5" />
    </>
  ),
  puzzle: (
    <>
      <path d="M4 7h4a2 2 0 1 1 4 0h4v4a2 2 0 1 1 0 4v4H4z" />
    </>
  ),
};

export function Icon({ name, size = 28 }: { name: string; size?: number }) {
  const shape = ICONS[name] ?? ICONS.globe;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {shape}
    </svg>
  );
}

type Tone = 'accent' | 'signal' | 'muted';

type FlowStepProps = {
  icon: string;
  title: string;
  /** Short label for the arrow leading INTO this step. */
  arrow?: string;
  tone?: Tone;
  children?: ReactNode;
};

export function FlowStep({ icon, title, tone = 'accent', children }: FlowStepProps) {
  return (
    <div className={`flow-step flow-tone-${tone}`}>
      <span className="flow-icon">
        <Icon name={icon} />
      </span>
      <strong className="flow-title">{title}</strong>
      {children ? <div className="flow-text">{children}</div> : null}
    </div>
  );
}

export function Flow({ caption, children }: { caption?: string; children: ReactNode }) {
  const steps = Children.toArray(children).filter(isValidElement) as ReactElement<FlowStepProps>[];
  const track: ReactNode[] = [];
  steps.forEach((step, i) => {
    if (i > 0) {
      track.push(
        <span className="flow-arrow" key={`arrow-${i}`} aria-hidden="true">
          <span className="flow-arrow-line" />
          {step.props.arrow ? <span className="flow-arrow-label">{step.props.arrow}</span> : null}
        </span>,
      );
    }
    track.push(step);
  });
  return (
    <figure className="doc-figure flow">
      <div className="flow-track">{track}</div>
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}

/** Escrow in one picture: pay in → locked box → provider paid for use, buyer refunded the rest. */
export function MoneyFlow({ caption }: { caption?: string }) {
  return (
    <figure className="doc-figure money">
      <div className="money-track">
        <div className="money-box">
          <span className="flow-icon flow-tone-accent">
            <Icon name="wallet" />
          </span>
          <strong>1. You pay</strong>
          <span>Money leaves your Solana wallet…</span>
        </div>
        <span className="money-arrow" aria-hidden="true" />
        <div className="money-box money-lock">
          <span className="flow-icon flow-tone-signal">
            <Icon name="lock" />
          </span>
          <strong>2. It waits in a locked box</strong>
          <span>…held by a program on Solana (the <em>escrow</em>). It can only go to the provider or back to you.</span>
        </div>
        <span className="money-arrow" aria-hidden="true" />
        <div className="money-split">
          <div className="money-box">
            <span className="flow-icon flow-tone-accent">
              <Icon name="paid" />
            </span>
            <strong>3a. Provider gets paid</strong>
            <span>…for exactly the data you used.</span>
          </div>
          <div className="money-box">
            <span className="flow-icon flow-tone-muted">
              <Icon name="refund" />
            </span>
            <strong>3b. You get the rest back</strong>
            <span>Whatever you didn’t use is refunded.</span>
          </div>
        </div>
      </div>
      <figcaption>
        {caption ?? 'Like a deposit held by a neutral referee: it only pays out for what was actually delivered.'}
      </figcaption>
    </figure>
  );
}

export function IdeaGrid({ children }: { children: ReactNode }) {
  return <div className="idea-grid">{children}</div>;
}

export function IdeaCard({
  icon,
  title,
  label,
  children,
}: {
  icon: string;
  title: string;
  /** Optional technical name shown as a small tag. */
  label?: string;
  children: ReactNode;
}) {
  return (
    <div className="idea-card">
      <div className="idea-head">
        <span className="flow-icon flow-tone-accent">
          <Icon name={icon} />
        </span>
        <strong className="idea-title">{title}</strong>
      </div>
      {label ? <span className="idea-label">{label}</span> : null}
      <div className="idea-body">{children}</div>
    </div>
  );
}
