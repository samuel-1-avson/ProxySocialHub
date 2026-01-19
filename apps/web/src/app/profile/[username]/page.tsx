"use client";

import { ProfileView } from "@/components/ProfileView";

export default function PublicProfilePage({ params }: { params: { username: string } }) {
    return <ProfileView username={params.username} />;
}
