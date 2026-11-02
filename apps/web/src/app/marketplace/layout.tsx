import { AppShell } from "@/components/AppShell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  // Every marketplace surface can open the buy flow (browse, listing detail,
  // map, create), and buying signs an escrow transaction with the browser
  // wallet. The wallet provider must therefore mount on all of them — gating
  // it to /marketplace/create left every Buy button on a disconnected
  // default wallet context ("connect wallet" forever, even signed in).
  return (
    <AppShell
      withWallet
      showDesktopActions={false}
      showBreadcrumbs={false}
      contentClassName="animate-in fade-in duration-500"
    >
      {children}
    </AppShell>
  );
}
