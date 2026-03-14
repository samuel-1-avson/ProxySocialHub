// Notifications API - ProxyHubb notification system
import { fetchWithAuth } from "./auth";

const API_BASE = ''; // relative — proxied by Next.js rewrite in next.config.ts

// ============== Types ==============

export enum NotificationType {
    // Social
    NewFollower = "new_follower",
    NewFriendRequest = "friend_request",
    FriendAccepted = "friend_accepted",
    Message = "message",
    Mention = "mention",

    // Business
    NewOrder = "new_order",
    OrderComplete = "order_complete",
    PaymentReceived = "payment_received",
    PaymentSent = "payment_sent",
    ListingSold = "listing_sold",

    // Community
    Reply = "reply",
    Upvote = "upvote",
    BadgeEarned = "badge_earned",
    ThreadFeatured = "thread_featured",

    // System
    SecurityAlert = "security_alert",
    Maintenance = "maintenance",
    Verification = "verification",
    TrustTierChange = "trust_tier_change",
}

export interface Notification {
    id: string;
    user_id: string;
    type: NotificationType;
    title: string;
    body?: string;
    action_url?: string;
    action_type?: string;
    actor_id?: string;
    target_type?: string;
    target_id?: string;
    is_read: boolean;
    read_at?: string;
    channels_delivered: string[];
    created_at: string;
    actor?: {
        id: string;
        username?: string;
        display_name?: string;
        avatar_url?: string;
    };
}

export interface NotificationPreference {
    user_id: string;
    social_in_app: boolean;
    social_email: boolean;
    social_push: boolean;
    business_in_app: boolean;
    business_email: boolean;
    business_push: boolean;
    community_in_app: boolean;
    community_email: boolean;
    community_push: boolean;
    system_in_app: boolean;
    system_email: boolean;
    system_push: boolean;
    email_digest_frequency: "immediate" | "hourly" | "daily";
    digest_day: string;
    digest_hour: number;
    updated_at: string;
}

// ============== API Functions ==============

export async function getNotifications(params: { page?: number; limit?: number; unread?: boolean } = {}): Promise<{
    notifications: Notification[];
    total: number;
    page: number;
    limit: number;
}> {
    const query = new URLSearchParams();
    if (params.page) query.set("page", String(params.page));
    if (params.limit) query.set("limit", String(params.limit));
    if (params.unread) query.set("unread", "true");

    const res = await fetchWithAuth(`${API_BASE}/v1/notifications?${query}`);
    if (!res.ok) {
        if (res.status === 404) return { notifications: [], total: 0, page: 1, limit: 20 };
        throw new Error("Failed to fetch notifications");
    }
    return res.json();
}

export async function getUnreadCount(): Promise<{ count: number }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/notifications/unread-count`);
    if (!res.ok) {
        if (res.status === 404) return { count: 0 };
        throw new Error("Failed to fetch unread count");
    }
    return res.json();
}

export async function markNotificationRead(notificationId: string): Promise<{ message: string }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/notifications/${notificationId}/read`, {
        method: "POST",
    });
    if (!res.ok) throw new Error("Failed to mark notification as read");
    return res.json();
}

export async function markAllNotificationsRead(): Promise<{ message: string }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/notifications/read-all`, {
        method: "POST",
    });
    if (!res.ok) throw new Error("Failed to mark all notifications as read");
    return res.json();
}

export async function deleteNotification(notificationId: string): Promise<{ message: string }> {
    const res = await fetchWithAuth(`${API_BASE}/v1/notifications/${notificationId}`, {
        method: "DELETE",
    });
    if (!res.ok) throw new Error("Failed to delete notification");
    return res.json();
}

// ============== Preferences ==============

export async function getNotificationPreferences(): Promise<NotificationPreference> {
    const res = await fetchWithAuth(`${API_BASE}/v1/notification-preferences`);
    if (!res.ok) throw new Error("Failed to fetch notification preferences");
    return res.json();
}

export async function updateNotificationPreferences(
    preferences: Partial<NotificationPreference>
): Promise<NotificationPreference> {
    const res = await fetchWithAuth(`${API_BASE}/v1/notification-preferences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preferences),
    });
    if (!res.ok) throw new Error("Failed to update notification preferences");
    return res.json();
}

// ============== Helper Functions ==============

export function getNotificationTypeLabel(type: NotificationType): string {
    const labels: Record<NotificationType, string> = {
        [NotificationType.NewFollower]: "New Follower",
        [NotificationType.NewFriendRequest]: "Friend Request",
        [NotificationType.FriendAccepted]: "Friend Accepted",
        [NotificationType.Message]: "New Message",
        [NotificationType.Mention]: "Mention",
        [NotificationType.NewOrder]: "New Order",
        [NotificationType.OrderComplete]: "Order Complete",
        [NotificationType.PaymentReceived]: "Payment Received",
        [NotificationType.PaymentSent]: "Payment Sent",
        [NotificationType.ListingSold]: "Listing Sold",
        [NotificationType.Reply]: "New Reply",
        [NotificationType.Upvote]: "Upvote",
        [NotificationType.BadgeEarned]: "Badge Earned",
        [NotificationType.ThreadFeatured]: "Thread Featured",
        [NotificationType.SecurityAlert]: "Security Alert",
        [NotificationType.Maintenance]: "Maintenance",
        [NotificationType.Verification]: "Verification",
        [NotificationType.TrustTierChange]: "Trust Tier Changed",
    };
    return labels[type] || "Notification";
}

export function getNotificationTypeCategory(type: NotificationType): "social" | "business" | "community" | "system" {
    const categories: Record<NotificationType, "social" | "business" | "community" | "system"> = {
        [NotificationType.NewFollower]: "social",
        [NotificationType.NewFriendRequest]: "social",
        [NotificationType.FriendAccepted]: "social",
        [NotificationType.Message]: "social",
        [NotificationType.Mention]: "social",
        [NotificationType.NewOrder]: "business",
        [NotificationType.OrderComplete]: "business",
        [NotificationType.PaymentReceived]: "business",
        [NotificationType.PaymentSent]: "business",
        [NotificationType.ListingSold]: "business",
        [NotificationType.Reply]: "community",
        [NotificationType.Upvote]: "community",
        [NotificationType.BadgeEarned]: "community",
        [NotificationType.ThreadFeatured]: "community",
        [NotificationType.SecurityAlert]: "system",
        [NotificationType.Maintenance]: "system",
        [NotificationType.Verification]: "system",
        [NotificationType.TrustTierChange]: "system",
    };
    return categories[type] || "system";
}
