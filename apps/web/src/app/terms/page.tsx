import { StaticInfoPage } from "@/components/StaticInfoPage";

export default function TermsPage() {
    return (
        <StaticInfoPage
            eyebrow="Legal"
            title="Terms of Service"
            summary="These working terms outline the expected use of ProxyHubb while the full legal policy is finalized."
            sections={[
                {
                    title: "Use of the marketplace",
                    body: "Users are responsible for lawful use of proxy services, accurate listing information, and respecting marketplace rules for orders, sessions, disputes, and refunds.",
                },
                {
                    title: "Provider responsibilities",
                    body: "Providers are responsible for the availability, quality, and accuracy of the bandwidth and infrastructure they publish through ProxyHubb.",
                },
                {
                    title: "Account and wallet security",
                    body: "Users are responsible for keeping account access, wallet connections, private keys, recovery methods, and API tokens secure.",
                },
            ]}
        />
    );
}
