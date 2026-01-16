'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface WebSocketMessage {
  type: string;
  target?: string;
  data: any;
  timestamp: number;
}

type MessageHandler = (message: WebSocketMessage) => void;

export function useWebSocket(url?: string) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<string, MessageHandler[]>>(new Map());
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const baseWsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080';
  const wsUrl = url || `${baseWsUrl}/v1/ws`;

  const connect = useCallback(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
    if (!token) return;

    try {
      const ws = new WebSocket(`${wsUrl}?token=${token}`);

      ws.onopen = () => {
        console.log('WebSocket connected');
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
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
        console.log('WebSocket disconnected');
        setIsConnected(false);
        // Reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      wsRef.current = ws;
    } catch (e) {
      console.error('WebSocket connection failed:', e);
    }
  }, [wsUrl]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

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
export function useSessionUpdates(onUpdate: (data: any) => void) {
  const { subscribe } = useRealtime();

  useEffect(() => {
    return subscribe(WS_MESSAGE_TYPES.SESSION_UPDATE, (msg) => onUpdate(msg.data));
  }, [subscribe, onUpdate]);
}

export function useWalletUpdates(onUpdate: (data: any) => void) {
  const { subscribe } = useRealtime();

  useEffect(() => {
    return subscribe(WS_MESSAGE_TYPES.WALLET_UPDATE, (msg) => onUpdate(msg.data));
  }, [subscribe, onUpdate]);
}

export function useNotifications(onNotification: (data: any) => void) {
  const { subscribe } = useRealtime();

  useEffect(() => {
    return subscribe(WS_MESSAGE_TYPES.NOTIFICATION, (msg) => onNotification(msg.data));
  }, [subscribe, onNotification]);
}
