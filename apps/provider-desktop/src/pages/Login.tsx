import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { LogIn, Shield } from "lucide-react";

export function Login() {
    const navigate = useNavigate();
    const { login } = useAuth();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            await login(email, password);
            navigate("/dashboard");
        } catch (err: any) {
            console.error(err);
            setError(err.message || "Invalid credentials or server error");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="max-w-md w-full mx-auto">
            <div className="text-center mb-10">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-primary text-primary-foreground border-4 border-foreground shadow-[4px_4px_0px_var(--foreground)] mb-6 rounded-sm">
                    <Shield className="w-8 h-8" />
                </div>
                <h1 className="text-3xl font-mono font-black uppercase tracking-tight mb-2">ACCESS_GATEWAY</h1>
                <p className="text-muted-foreground font-mono text-sm uppercase tracking-widest">Identify yourself to continue</p>
            </div>

            <form onSubmit={handleSubmit} className="card-retro p-8 bg-card space-y-6">
                <div className="space-y-2">
                    <label className="block text-xs font-mono font-bold uppercase tracking-wider text-muted-foreground">
                        Operator_Email
                    </label>
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        placeholder="admin@proxyhubb.com"
                        className="w-full bg-background border-2 border-border p-3 font-mono text-sm focus:border-primary focus:ring-0 rounded-sm transition-colors outline-none"
                    />
                </div>
                <div className="space-y-2">
                    <label className="block text-xs font-mono font-bold uppercase tracking-wider text-muted-foreground">
                        Security_Key
                    </label>
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        placeholder="••••••••"
                        className="w-full bg-background border-2 border-border p-3 font-mono text-sm focus:border-primary focus:ring-0 rounded-sm transition-colors outline-none"
                    />
                </div>

                {error && (
                    <div className="p-3 text-xs font-mono font-bold text-destructive bg-destructive/10 border border-destructive/20 rounded-sm">
                        ERROR: {error.toUpperCase()}
                    </div>
                )}

                <button
                    type="submit"
                    disabled={loading}
                    className="btn-retro btn-retro-primary w-full py-4 text-sm font-bold uppercase tracking-widest flex items-center gap-2 group"
                >
                    {loading ? "AUTHENTICATING..." : (
                        <>
                            <LogIn className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                            EXECUTE_LOGIN
                        </>
                    )}
                </button>

                <div className="pt-4 border-t border-border text-center">
                    <p className="text-xs font-mono text-muted-foreground uppercase">
                        New Operator?{" "}
                        <a
                            href="https://proxyhubb.com/register"
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline font-bold"
                        >
                            ENROLL_ON_WEB
                        </a>
                    </p>
                </div>
            </form>

            <div className="mt-8 text-center">
                <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-[0.2em]">
                    ProxySocialHub Secure Terminal v2.0
                </p>
            </div>
        </div>
    );
}
