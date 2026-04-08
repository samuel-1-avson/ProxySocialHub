"use client";

import { use } from "react";
import { ProfileView } from "@/components/ProfileView";

export default function PublicProfilePage({ params }: { params: Promise<{ username: string }> }) {
    const { username } = use(params);
    return <ProfileView username={username} />;
}
