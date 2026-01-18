import { Outlet } from "react-router-dom";
import { Globe } from "lucide-react";

export function AuthLayout() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
            <div className="card w-full max-w-md p-8 bg-white dark:bg-gray-800 shadow-xl rounded-lg">
                <div className="flex justify-center mb-6">
                    <div className="p-3 bg-green-100 dark:bg-green-900 rounded-full">
                        <Globe className="w-8 h-8 text-green-600 dark:text-green-400" />
                    </div>
                </div>
                <h1 className="text-2xl font-bold text-center mb-2 text-gray-900 dark:text-gray-100">
                    ProxyHub Provider
                </h1>
                <p className="text-center text-gray-500 mb-8">
                    Share your bandwidth and earn revenue.
                </p>
                <Outlet />
            </div>
        </div>
    );
}
