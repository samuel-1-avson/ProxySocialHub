import { useEffect, useState } from 'react';
import { circles, Circle } from '../lib/api';
import { Users, Plus, Loader } from "lucide-react";

export function CirclesTab() {
    const [list, setList] = useState<Circle[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [view, setView] = useState<'list' | 'create'>('list');

    // Create Form State
    const [newName, setNewName] = useState('');
    const [newDesc, setNewDesc] = useState('');
    const [isPrivate, setIsPrivate] = useState(false);
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        loadCircles();
    }, []);

    const loadCircles = async () => {
        try {
            setLoading(true);
            const data = await circles.getAll();
            setList(data);
        } catch (err) {
            setError('Failed to load circles');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setCreating(true);
        try {
            await circles.create({
                name: newName,
                description: newDesc,
                visibility: isPrivate ? 'private' : 'public'
            });
            setView('list');
            loadCircles();
            setNewName('');
            setNewDesc('');
        } catch (err) {
            alert("Failed to create circle");
        } finally {
            setCreating(false);
        }
    };

    const handleJoin = async (id: string) => {
        try {
            await circles.join(id);
            alert("Joined circle!");
            loadCircles();
        } catch (err) {
            alert("Failed to join");
        }
    };

    if (view === 'create') {
        return (
            <div className="p-6">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-2xl font-bold">Create Circle</h2>
                    <button onClick={() => setView('list')} className="text-sm text-gray-500 hover:text-gray-700">Cancel</button>
                </div>
                <form onSubmit={handleCreate} className="max-w-md space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">Name</label>
                        <input
                            className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Description</label>
                        <textarea
                            className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
                            value={newDesc}
                            onChange={e => setNewDesc(e.target.value)}
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={isPrivate}
                            onChange={e => setIsPrivate(e.target.checked)}
                            id="private"
                        />
                        <label htmlFor="private">Private (Invite Only)</label>
                    </div>
                    <button
                        type="submit"
                        disabled={creating}
                        className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50"
                    >
                        {creating ? "Creating..." : "Create Circle"}
                    </button>
                </form>
            </div>
        );
    }

    return (
        <div className="p-6">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h2 className="text-2xl font-bold flex items-center gap-2">
                        <Users className="w-6 h-6" /> Circles
                    </h2>
                    <p className="text-gray-500 text-sm">Join a clan to share resources and earn multipliers.</p>
                </div>
                <button
                    onClick={() => setView('create')}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
                >
                    <Plus className="w-4 h-4" /> Create
                </button>
            </div>

            {error && (
                <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">{error}</div>
            )}

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader className="w-8 h-8 animate-spin text-gray-400" />
                </div>
            ) : list.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 dark:bg-gray-800 rounded-lg dashed-border">
                    <p>No circles found.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {list.map(circle => (
                        <div key={circle.id} className="border dark:border-gray-700 bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm hover:shadow-md transition-shadow">
                            <div className="flex justify-between items-start mb-2">
                                <h3 className="font-bold text-lg">{circle.name}</h3>
                                <span className={`text-xs px-2 py-1 rounded-full ${circle.visibility === 'public' ? 'bg-green-100 text-green-800' : 'bg-purple-100 text-purple-800'}`}>
                                    {circle.visibility}
                                </span>
                            </div>
                            <p className="text-sm text-gray-500 mb-4 h-10 line-clamp-2">{circle.description}</p>
                            <div className="flex justify-between items-center mt-4 border-t pt-4 dark:border-gray-700">
                                <div className="text-xs text-gray-500 flex items-center gap-1">
                                    <Users className="w-3 h-3" /> {circle.member_count} Members
                                </div>
                                <button
                                    onClick={() => handleJoin(circle.id)}
                                    className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                                >
                                    Join
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
