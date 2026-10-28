import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { ROUTES } from "@/lib/navigation/routes";

interface StaticInfoPageProps {
    eyebrow: string;
    title: string;
    summary: string;
    sections: Array<{
        title: string;
        body: string;
    }>;
    links?: Array<{
        href: string;
        label: string;
        secondary?: boolean;
    }>;
}

export function StaticInfoPage({ eyebrow, title, summary, sections, links }: StaticInfoPageProps) {
    const actions = links ?? [
        { href: ROUTES.marketplace, label: "Browse marketplace" },
        { href: ROUTES.contact, label: "Contact support", secondary: true },
    ];

    return (
        <div className="min-h-screen bg-background text-foreground">
            <Navbar showAuth={true} />
            <main className="mx-auto max-w-5xl px-4 py-10 md:px-6 md:py-16">
                <header className="mb-8 max-w-3xl">
                    <p className="ui-eyebrow">{eyebrow}</p>
                    <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">{title}</h1>
                    <p className="mt-3 text-base leading-7 text-muted-foreground">{summary}</p>
                </header>

                <div className="grid gap-4 md:grid-cols-2">
                    {sections.map((section) => (
                        <section key={section.title} className="ui-surface">
                            <h2 className="text-lg font-semibold tracking-tight">{section.title}</h2>
                            <p className="mt-2 text-sm leading-6 text-muted-foreground">{section.body}</p>
                        </section>
                    ))}
                </div>

                <div className="mt-8 flex flex-wrap gap-3">
                    {actions.map((action) => (
                        <Link key={action.href} href={action.href} className={`ui-button${action.secondary ? " secondary" : ""}`}>
                            {action.label}
                        </Link>
                    ))}
                </div>
            </main>
        </div>
    );
}
