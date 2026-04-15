'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { getRealtimeWsUrl } from './ws-url';

interface WebSocketMessage {
  type: string;
  target?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  timestamp: number;
}

type MessageHandler = (message: WebSocketMessage) => void;

export function useWebSocket(url?: string) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<string, MessageHandler[]>>(new Map());
  const lastMessageRef = useRef<WebSocketMessage | null>(null);

  const wsUrl = url || getRealtimeWsUrl();


  const connect = useCallback(async () => {
    // Read JWT from local storage — issued by the self-hosted backend on login.
    const token = typeof window !== 'undefined' ? localStorage.getItem('proxyhubb_token') : null;

    if (!token) return;

    // Prevent duplicate connections
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    try {
      const ws = new WebSocket(`${wsUrl}?token=${token}`);

      ws.onopen = () => {
        if (wsRef.current !== ws) return; // stale instance
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        if (wsRef.current !== ws) return; // stale instance
        try {
          const messages = event.data.split('\n');
          messages.forEach((msgStr: string) => {
            if (!msgStr.trim()) return;
            const message: WebSocketMessage = JSON.parse(msgStr);
            setLastMessage(message);

            // Call registered handlers
            const handlers = handlersRef.current.get(message.type) || [];
            handlers.forEach(handler => handler(message));

            // Call wildcard handlers
            const wildcardHandlers = handlersRef.current.get('*') || [];
            wildcardHandlers.forEach(handler => handler(message));
          });
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e);
        }
      };

      ws.onclose = () => {
        if (wsRef.current !== ws) return; // stale instance
        wsRef.current = null;
        setIsConnected(false);
      };

      ws.onerror = (error) => {
        if (wsRef.current !== ws) return; // stale instance
        console.error('WebSocket error:', error);
      };

      wsRef.current = ws;
    } catch (e) {
      console.error('WebSocket connection failed:', e);
    }
  }, [wsUrl]);

  // Handle reconnection separately to avoid circular dependency
  useEffect(() => {
    if (!isConnected) {
      const timeout = setTimeout(() => {
        connect();
      }, 3000);
      return () => clearTimeout(timeout);
    }
  }, [isConnected, connect]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const send = useCallback((type: string, data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, data, timestamp: Date.now() }));
    }
  }, []);

  const subscribe = useCallback((type: string, handler: MessageHandler) => {
    const handlers = handlersRef.current.get(type) || [];
    handlers.push(handler);
    handlersRef.current.set(type, handlers);

    // Return unsubscribe function
    return () => {
      const handlers = handlersRef.current.get(type) || [];
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
        handlersRef.current.set(type, handlers);
      }
    };
  }, []);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return {
    isConnected,
    lastMessage,
    send,
    subscribe,
    connect,
    disconnect,
  };
}

// Message types
export const WS_MESSAGE_TYPES = {
  SESSION_UPDATE: 'session_update',
  WALLET_UPDATE: 'wallet_update',
  USAGE_UPDATE: 'usage_update',
  PROVIDER_STATUS: 'provider_status',
  NOTIFICATION: 'notification',
  KYC_UPDATE: 'kyc_update',
  SYSTEM_ALERT: 'system_alert',
  // Social feature message types
  NEW_MESSAGE: 'new_message',
  NEW_ORDER: 'new_order',
  NEW_REVIEW: 'new_review',
  NEW_FOLLOWER: 'new_follower',
  ORDER_UPDATE: 'order_update',
} as const;

// Real-time provider context
import { createContext, useContext, ReactNode } from 'react';

interface RealtimeContextType {
  isConnected: boolean;
  subscribe: (type: string, handler: MessageHandler) => () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  send: (type: string, data: any) => void;
}

const RealtimeContext = createContext<RealtimeContextType | null>(null);

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const ws = useWebSocket();

  return (
    <RealtimeContext.Provider value={{
      isConnected: ws.isConnected,
      subscribe: ws.subscribe,
      send: ws.send,
    }}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error('useRealtime must be used within RealtimeProvider');
  }
  return context;
}

// Hooks for specific message types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useSessionUpdates(onUpdate: (data: any) => void) {
  const { subscribe } = useRealtime();

  useEffect(() => {
    return subscribe(WS_MESSAGE_TYPES.SESSION_UPDATE, (msg) => onUpdate(msg.data));
  }, [subscribe, onUpdate]);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useWalletUpdates(onUpdate: (data: any) => void) {
  const { subscribe } = useRealtime();

  useEffect(() => {
    return subscribe(WS_MESSAGE_TYPES.WALLET_UPDATE, (msg) => onUpdate(msg.data));
  }, [subscribe, onUpdate]);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useNotifications(onNotification: (data: any) => void) {
  const { subscribe } = useRealtime();

  useEffect(() => {
    return subscribe(WS_MESSAGE_TYPES.NOTIFICATION, (msg) => onNotification(msg.data));
  }, [subscribe, onNotification]);
}
