'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { MessageSquare, Users, Hash, ChevronRight } from 'lucide-react';
import { getForumCategories, ForumCategory } from '@/lib/api';

export default function ForumCategoriesPage() {
    const [categories, setCategories] = useState<ForumCategory[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            const data = await getForumCategories();
            setCategories(data.categories);
        } catch (error) {
            console.error('Failed to fetch categories:', error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[50vh]">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-500"></div>
            </div>
        );
    }

    return (
        <div className="space-y-8 p-6 max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">Community Forum</h1>
                    <p className="text-white/60 mt-1">Discuss proxies, automation, and tech with the community.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {categories.map((category, idx) => (
                    <Link href={`/forum/${category.slug}`} key={category.id}>
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.1 }}
                            className="group p-6 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-primary-500/30 transition-all cursor-pointer h-full flex flex-col justify-between"
                        >
                            <div>
                                <div className="flex items-center justify-between mb-4">
                                    <div className="p-3 rounded-xl bg-primary-500/20 text-primary-400 group-hover:scale-110 transition-transform">
                                        <Hash className="w-6 h-6" />
                                    </div>
                                    <ChevronRight className="w-5 h-5 text-white/20 group-hover:text-white/60 group-hover:translate-x-1 transition-all" />
                                </div>

                                <h3 className="text-xl font-bold text-white mb-2 group-hover:text-primary-400 transition-colors">
                                    {category.name}
                                </h3>
                                <p className="text-white/60 text-sm line-clamp-2">
                                    {category.description}
                                </p>
                            </div>

                            <div className="mt-6 flex items-center gap-4 text-xs font-medium text-white/40">
                                <div className="flex items-center gap-1">
                                    <MessageSquare className="w-3 h-3" />
                                    {category.thread_count || 0} Threads
                                </div>
                            </div>
                        </motion.div>
                    </Link>
                ))}

                {categories.length === 0 && (
                    <div className="col-span-full text-center py-12 border-2 border-dashed border-white/10 rounded-2xl">
                        <MessageSquare className="w-12 h-12 text-white/20 mx-auto mb-4" />
                        <p className="text-white/40">No categories found.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
