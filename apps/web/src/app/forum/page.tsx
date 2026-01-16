'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { getForumCategories, ForumCategory } from '@/lib/api';
import { Megaphone, Book, Monitor, ShoppingCart, HelpCircle, Lightbulb, MessageCircle, Folder } from 'lucide-react';

export default function ForumPage() {
    const [categories, setCategories] = useState<ForumCategory[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function loadData() {
            try {
                const data = await getForumCategories();
                setCategories(data.categories);
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        }
        loadData();
    }, []);

    const getIcon = (iconName: string) => {
        const props = { className: "w-8 h-8" };
        switch (iconName) {
            case 'megaphone': return <Megaphone {...props} className="w-8 h-8 text-indigo-400" />;
            case 'book': return <Book {...props} className="w-8 h-8 text-blue-400" />;
            case 'server': return <Monitor {...props} className="w-8 h-8 text-green-400" />;
            case 'shopping-cart': return <ShoppingCart {...props} className="w-8 h-8 text-orange-400" />;
            case 'help-circle': return <HelpCircle {...props} className="w-8 h-8 text-purple-400" />;
            case 'lightbulb': return <Lightbulb {...props} className="w-8 h-8 text-yellow-400" />;
            case 'message-circle': return <MessageCircle {...props} className="w-8 h-8 text-pink-400" />;
            default: return <Folder {...props} className="w-8 h-8 text-gray-400" />;
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-900 text-white">
                <Navbar />
                <div className="flex justify-center items-center h-[calc(100vh-64px)]">
                    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-900 text-white">
            <Navbar />
            <div className="max-w-7xl mx-auto px-4 py-8">
                <div className="flex justify-between items-center mb-12">
                    <div>
                        <h1 className="text-3xl font-bold mb-2">Community Forum</h1>
                        <p className="text-gray-400">Join the discussion with other ProxySocialHub users.</p>
                    </div>
                    <button className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg font-bold transition-colors">
                        New Discussion
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {categories.map((cat) => (
                        <Link
                            key={cat.id}
                            href={`/forum/${cat.slug}`}
                            className="bg-gray-800 rounded-xl p-6 border border-gray-700 hover:border-indigo-500 hover:bg-gray-750 transition-all group"
                        >
                            <div className="flex items-start justify-between mb-4">
                                <div className="text-4xl">{getIcon(cat.icon)}</div>
                                <div className="px-3 py-1 bg-gray-700 rounded-full text-xs text-gray-400 group-hover:bg-indigo-900/50 group-hover:text-indigo-300 transition-colors">
                                    {cat.thread_count} threads
                                </div>
                            </div>
                            <h3 className="text-xl font-bold mb-2 group-hover:text-indigo-400 transition-colors">{cat.name}</h3>
                            <p className="text-gray-400 text-sm h-10 overflow-hidden">{cat.description}</p>
                        </Link>
                    ))}
                </div>

                <div className="mt-12 bg-gray-800/50 rounded-xl p-8 border border-gray-700 text-center">
                    <h2 className="text-2xl font-bold mb-4">Need personalized help?</h2>
                    <p className="text-gray-400 mb-6">Our support team is available 24/7 for premium members.</p>
                    <a href="#" className="text-indigo-400 hover:text-indigo-300 font-bold underline">Contact Support &rarr;</a>
                </div>
            </div>
        </div>
    );
}
