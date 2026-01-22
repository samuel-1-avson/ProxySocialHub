import { supabase } from '../lib/supabase';

export type Thread = {
    id: string;
    title: string;
    content: string;
    author_id: string;
    created_at: string;
    updated_at: string;
    views: number;
    reply_count: number;
    category: string;
    author?: {
        username: string;
        avatar_url: string;
    };
};

export type Reply = {
    id: string;
    thread_id: string;
    content: string;
    author_id: string;
    created_at: string;
    author?: {
        username: string;
        avatar_url: string;
    };
};

// Mock data for development until backend is ready
const MOCK_THREADS: Thread[] = [
    {
        id: '1',
        title: 'Best proxy settings for Instagram?',
        content: 'I am trying to run an Instagram automation bot. What settings do you recommend?',
        author_id: 'user1',
        created_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), // 2 hours ago
        updated_at: new Date().toISOString(),
        views: 124,
        reply_count: 5,
        category: 'Automation',
        author: { username: 'ig_master', avatar_url: 'https://i.pravatar.cc/150?u=1' }
    },
    {
        id: '2',
        title: 'ProxyHub Node Setup Guide',
        content: 'Here is a comprehensive guide on how to set up your own node and start earning.',
        author_id: 'admin',
        created_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), // 1 day ago
        updated_at: new Date().toISOString(),
        views: 543,
        reply_count: 12,
        category: 'Guides',
        author: { username: 'Admin', avatar_url: 'https://i.pravatar.cc/150?u=admin' }
    },
    {
        id: '3',
        title: 'Proposal: Reduce platform fees',
        content: 'I think we should reduce the platform fees to attract more providers.',
        author_id: 'user2',
        created_at: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
        updated_at: new Date().toISOString(),
        views: 89,
        reply_count: 3,
        category: 'Governance',
        author: { username: 'dao_voter', avatar_url: 'https://i.pravatar.cc/150?u=2' }
    }
];

export async function getThreads(category?: string): Promise<Thread[]> {
    // TODO: Replace with actual API call
    // const { data, error } = await supabase.from('threads').select('*, author:profiles(*)');
    // if (error) throw error;
    // return data;

    await new Promise(resolve => setTimeout(resolve, 800)); // Simulate latency
    if (category) {
        return MOCK_THREADS.filter(t => t.category === category);
    }
    return MOCK_THREADS;
}

export async function getThreadDetails(id: string): Promise<Thread | null> {
    await new Promise(resolve => setTimeout(resolve, 500));
    return MOCK_THREADS.find(t => t.id === id) || null;
}

export async function getReplies(threadId: string): Promise<Reply[]> {
    await new Promise(resolve => setTimeout(resolve, 600));
    return [
        {
            id: '101',
            thread_id: threadId,
            content: 'I usually use residential proxies for IG. Sticky sessions work best.',
            author_id: 'user3',
            created_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
            author: { username: 'proxy_king', avatar_url: 'https://i.pravatar.cc/150?u=3' }
        },
        {
            id: '102',
            thread_id: threadId,
            content: 'Agreed, data center IPs get flagged too easily.',
            author_id: 'user4',
            created_at: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
            author: { username: 'net_walker', avatar_url: 'https://i.pravatar.cc/150?u=4' }
        }
    ];
}

export async function createThread(title: string, content: string, category: string): Promise<Thread> {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const newThread: Thread = {
        id: Math.random().toString(),
        title,
        content,
        author_id: 'current_user',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        views: 0,
        reply_count: 0,
        category,
        author: { username: 'You', avatar_url: 'https://i.pravatar.cc/150?u=me' }
    };
    MOCK_THREADS.unshift(newThread);
    return newThread;
}

export async function postReply(threadId: string, content: string): Promise<Reply> {
    await new Promise(resolve => setTimeout(resolve, 800));
    return {
        id: Math.random().toString(),
        thread_id: threadId,
        content,
        author_id: 'current_user',
        created_at: new Date().toISOString(),
        author: { username: 'You', avatar_url: 'https://i.pravatar.cc/150?u=me' }
    };
}
