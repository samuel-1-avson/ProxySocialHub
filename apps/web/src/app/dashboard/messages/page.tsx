'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { getConversations, getMessages, sendMessage, startConversation, listFriends, ConversationWithPreview, Message, Friendship } from '@/lib/api';
import { Send, User, Search, Plus, MessageSquare } from 'lucide-react';

export default function MessagesPage() {
    const { isAuthenticated, user: authUser } = useAuth();
    const [conversations, setConversations] = useState<ConversationWithPreview[]>([]);
    const [activeConvId, setActiveConvId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputText, setInputText] = useState('');
    const [loading, setLoading] = useState(true);
    const [friends, setFriends] = useState<Friendship[]>([]);
    const [showNewModal, setShowNewModal] = useState(false);

    // Auto-scroll ref
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isAuthenticated) return;
        loadConversations();
    }, [isAuthenticated]);

    useEffect(() => {
        if (activeConvId) {
            loadMessages(activeConvId);
            const interval = setInterval(() => loadMessages(activeConvId), 3000); // Poll for new messages
            return () => clearInterval(interval);
        }
    }, [activeConvId]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const loadConversations = async () => {
        try {
            const data = await getConversations();
            setConversations(data);
            setLoading(false);
        } catch (err) {
            console.error(err);
            setLoading(false);
        }
    };

    const loadMessages = async (convId: string) => {
        try {
            const msgs = await getMessages(convId);
            setMessages(msgs.reverse()); // Backend returns newest first usually, we want chat order
        } catch (err) {
            console.error(err);
        }
    };

    const handleSend = async () => {
        if (!inputText.trim() || !activeConvId) return;
        try {
            await sendMessage(activeConvId, inputText);
            setInputText('');
            loadMessages(activeConvId);
            loadConversations(); // Update preview
        } catch (err) {
            alert('Failed to send message');
        }
    };

    const handleNewMessage = async (friendId: string) => {
        try {
            const conv = await startConversation(friendId);
            setShowNewModal(false);
            setActiveConvId(conv.id);
            loadConversations();
        } catch (err) {
            alert('Failed to start conversation');
        }
    };


    const openNewModal = async () => {
        setShowNewModal(true);
        try {
            const myFriends = await listFriends();
            setFriends(myFriends);
        } catch (err) {
            console.error(err);
        }
    };

    if (loading) return <div className="p-8 text-center font-mono">LOADING ENCRYPTED CHANNELS...</div>;

    const activeConv = conversations.find(c => c.conversation.id === activeConvId);

    return (
        <div className="flex h-[calc(100vh-120px)] border border-border rounded-lg overflow-hidden animate-in fade-in duration-500 bg-card">
            {/* Sidebar */}
            <div className="w-1/3 border-r border-border flex flex-col bg-secondary/10">
                <div className="p-4 border-b border-border flex justify-between items-center">
                    <h2 className="font-bold font-mono uppercase text-sm">Messages</h2>
                    <button onClick={openNewModal} className="btn-retro btn-retro-sm btn-retro-primary px-2">
                        <Plus size={14} />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {conversations.length === 0 ? (
                        <div className="p-4 text-center text-xs text-muted-foreground font-mono opacity-50">
                            NO ACTIVE CHANNELS
                        </div>
                    ) : (
                        conversations.map(c => (
                            <div
                                key={c.conversation.id}
                                onClick={() => setActiveConvId(c.conversation.id)}
                                className={`p-4 border-b border-border cursor-pointer hover:bg-secondary/20 transition-colors ${activeConvId === c.conversation.id ? 'bg-secondary/30 box-glow-sm' : ''}`}
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-secondary border border-border flex items-center justify-center overflow-hidden">
                                        {c.other_participant?.avatar_url ? (
                                            <img src={c.other_participant.avatar_url} className="w-full h-full object-cover" />
                                        ) : (
                                            <User size={20} className="text-muted-foreground" />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-baseline mb-1">
                                            <h3 className="font-bold font-mono text-xs truncate">
                                                {c.other_participant?.display_name || 'Unknown'}
                                            </h3>
                                            <span className="text-[10px] text-muted-foreground">
                                                {c.last_message ? new Date(c.last_message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                                            </span>
                                        </div>
                                        <p className="text-xs text-muted-foreground truncate font-mono opacity-70">
                                            {c.last_message?.content || 'Started conversation'}
                                        </p>
                                    </div>
                                    {c.unread_count > 0 && (
                                        <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                                            {c.unread_count}
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Chat Area */}
            <div className="flex-1 flex flex-col bg-background">
                {activeConv ? (
                    <>
                        {/* Header */}
                        <div className="p-4 border-b border-border flex items-center gap-3 bg-card/50">
                            <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
                                <User size={16} />
                            </div>
                            <div>
                                <h3 className="font-bold font-mono text-sm">
                                    {activeConv.other_participant?.display_name || 'Unknown User'}
                                </h3>
                                <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> ONLINE
                                </div>
                            </div>
                        </div>

                        {/* Messages */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-4">
                            {messages.map(msg => {
                                const isMe = msg.sender_id === authUser?.id;
                                return (
                                    <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`max-w-[70%] rounded-lg p-3 ${isMe ? 'bg-primary/20 border border-primary/30 text-right' : 'bg-secondary border border-border'}`}>
                                            <p className="text-sm">{msg.content}</p>
                                            <span className="text-[10px] text-muted-foreground block mt-1 opacity-70">
                                                {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Input */}
                        <div className="p-4 border-t border-border bg-card/50">
                            <form
                                onSubmit={(e) => { e.preventDefault(); handleSend(); }}
                                className="flex gap-2"
                            >
                                <input
                                    type="text"
                                    value={inputText}
                                    onChange={(e) => setInputText(e.target.value)}
                                    placeholder="Type a message..."
                                    className="flex-1 bg-secondary border border-border rounded-sm px-4 py-2 text-sm font-mono focus:border-primary outline-none"
                                />
                                <button type="submit" className="btn-retro btn-retro-primary btn-retro-sm px-4">
                                    <Send size={16} />
                                </button>
                            </form>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                        <MessageSquare size={48} className="opacity-20 mb-4" />
                        <p className="font-mono text-sm">SELECT A CONVERSATION OR START A NEW ONE</p>
                    </div>
                )}
            </div>

            {/* New Message Modal */}
            {showNewModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
                    <div className="bg-card border border-border p-6 rounded-lg w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
                        <h3 className="text-lg font-bold font-mono uppercase mb-4">Start Conversation</h3>
                        <p className="text-xs text-muted-foreground mb-4">Select a friend to message.</p>

                        <div className="space-y-2 mb-4 max-h-60 overflow-y-auto">
                            {friends.length === 0 ? (
                                <div className="text-center text-xs text-muted-foreground font-mono py-4">
                                    NO FRIENDS FOUND. ADD FRIENDS VIA PROFILE.
                                </div>
                            ) : (
                                friends.map(friend => (
                                    <div key={friend.id}
                                        onClick={() => handleNewMessage(friend.friend_id === authUser?.id ? (friend.user_id ?? friend.friend_id) : friend.friend_id)}
                                        className="p-3 border border-border rounded-sm hover:bg-secondary cursor-pointer flex items-center gap-3 transition-colors"
                                    >
                                        <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
                                            <User size={16} />
                                        </div>
                                        <span className="font-mono text-sm">
                                            {/* We need friend detail here, assuming friend object has populated profile or we use ID */}
                                            {friend.friend?.display_name || 'Friend'}
                                        </span>
                                    </div>
                                ))
                            )}
                        </div>


                        <div className="flex justify-end gap-2">
                            <button onClick={() => setShowNewModal(false)} className="btn-retro btn-retro-ghost btn-retro-sm">CANCEL</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
