import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { RealtimeProvider } from "@/lib/websocket";
import { ROUTES } from "@/lib/navigation/routes";

interface StaticInfoPageProps {
    eyebrow: string;
    title: string;
    summary: string;
    sections: Array<{
        title: string;
        body: string;
    }>;
}

export function StaticInfoPage({ eyebrow, title, summary, sections }: StaticInfoPageProps) {
    return (
        <RealtimeProvider>
        <div className="min-h-screen bg-background text-foreground">
            <Navbar showAuth={true} />
            <main className="container mx-auto max-w-4xl px-4 py-16 md:py-24">
                <div className="mb-10 border-b border-border pb-8">
                    <p className="mb-3 text-xs font-bold uppercase tracking-widest text-primary">{eyebrow}</p>
                    <h1 className="text-4xl font-black tracking-tight md:text-5xl">{title}</h1>
                    <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">{summary}</p>
                </div>

                <div className="space-y-8">
                    {sections.map((section) => (
                        <section key={section.title} className="border-b border-border/60 pb-8 last:border-b-0">
                            <h2 className="text-xl font-bold">{section.title}</h2>
                            <p className="mt-3 leading-7 text-muted-foreground">{section.body}</p>
                        </section>
                    ))}
                </div>

                <div className="mt-12 flex flex-wrap gap-3">
                    <Link href={ROUTES.marketplace} className="btn-retro btn-retro-primary px-5 py-3 text-xs">
                        Browse marketplace
                    </Link>
                    <Link href={ROUTES.contact} className="btn-retro btn-retro-outline px-5 py-3 text-xs">
                        Contact support
                    </Link>
                </div>
            </main>
        </div>
        </RealtimeProvider>
    );
}
