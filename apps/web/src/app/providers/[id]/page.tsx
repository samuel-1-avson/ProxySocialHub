"use client";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ProfileView } from "@/components/ProfileView";

export default function ProviderProfilePage() {
  const { id } = useParams<{ id: string }>();
  return (
    <AppShell showBreadcrumbs={false} showDesktopActions={false}>
      <ProfileView username={id} />
    </AppShell>
  );
}
