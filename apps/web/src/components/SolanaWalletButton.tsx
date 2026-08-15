'use client';

import { FC } from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import styles from './SolanaWalletButton.module.css';

type SolanaWalletButtonProps = {
  /** Stretch to parent width (narrow sidebars / cards). */
  fullWidth?: boolean;
  className?: string;
};

/**
 * Single control: WalletMultiButton already shows connect / connected address.
 * Do not render a second address chip beside it — that overlaps in tight layouts.
 */
export const SolanaWalletButton: FC<SolanaWalletButtonProps> = ({
  fullWidth = false,
  className = '',
}) => {
  return (
    <div
      className={[
        styles.walletContainer,
        fullWidth ? styles.walletContainerFull : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <WalletMultiButton className={styles.walletButton} />
    </div>
  );
};

export default SolanaWalletButton;
