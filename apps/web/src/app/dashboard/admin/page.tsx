import Link from 'next/link';
import { ArrowLeft, ShieldAlert } from 'lucide-react';

export default function AdminPage() {
    return (
        <div className="mx-auto flex min-h-[60vh] max-w-3xl items-center justify-center px-6 py-12">
            <div className="w-full rounded-3xl border border-amber-500/20 bg-amber-500/5 p-8 shadow-xl">
                <div className="mb-6 flex items-center gap-3 text-amber-300">
                    <ShieldAlert className="h-6 w-6" />
                    <span className="text-xs font-black uppercase tracking-[0.3em]">Disabled Surface</span>
                </div>

                <h1 className="mb-4 text-3xl font-black tracking-tight text-foreground">Legacy admin dashboard removed</h1>
                <p className="mb-3 text-sm leading-6 text-muted-foreground">
                    This route is intentionally no longer active. The backend admin control surface was retired, and
                    requests to admin APIs now fail closed instead of serving operator actions from the web app.
                </p>
                <p className="mb-8 text-sm leading-6 text-muted-foreground">
                    If you reached this page from older bookmarks, tests, or docs, update them to the current
                    operator and product workflows before widening user testing.
                </p>

                <div className="flex flex-wrap gap-3">
                    <Link
                        href="/dashboard"
                        className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-xs font-black uppercase tracking-[0.2em] text-primary-foreground transition-all hover:brightness-110"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Back To Dashboard
                    </Link>
                    <Link
                        href="/dashboard/provider"
                        className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs font-black uppercase tracking-[0.2em] text-foreground transition-all hover:border-white/20 hover:bg-white/10"
                    >
                        Review Provider Workspace
                    </Link>
                </div>
            </div>
        </div>
    );
}
