"use client";

import { ProfileView } from "@/components/ProfileView";

export default function PublicProfilePage() {
    // We don't pass username prop here, relying on ProfileView to pick it up from params
    // or we can explicitly pass it if we wanted to extract it here. 
    // ProfileView uses useParams() so it handles implementation details.
    return <ProfileView />;
}
