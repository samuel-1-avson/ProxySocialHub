import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { auth } from "../lib/api";
import { LogIn } from "lucide-react";

export function Login() {
    const navigate = useNavigate();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            await auth.login(email, password);
            navigate("/dashboard");
        } catch (err) {
            console.error(err);
            setError("Invalid credentials or server error");
        } finally {
            setLoading(false);
        }
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Email
                </label>
                <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full px-3 py-2 border rounded-md focus:ring-green-500 focus:border-green-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Password
                </label>
                <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full px-3 py-2 border rounded-md focus:ring-green-500 focus:border-green-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                />
            </div>

            {error && (
                <div className="p-3 text-sm text-red-600 bg-red-50 rounded-md">
                    {error}
                </div>
            )}

            <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center items-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 transition-colors"
            >
                {loading ? "Signing in..." : (
                    <>
                        <LogIn className="w-4 h-4 mr-2" /> Sign In
                    </>
                )}
            </button>

            <div className="text-center text-sm">
                <span className="text-gray-500">Don't have an account? </span>
                <a
                    href="https://proxyhubb.com/register"
                    target="_blank"
                    rel="noreferrer"
                    className="text-green-600 hover:text-green-500 font-medium"
                >
                    Register on Web
                </a>
            </div>
        </form>
    );
}
