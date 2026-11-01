import { Loading as LoadingState } from "@/components/workspace/Patterns";

export default function Loading() {
  return (
    <div className="public-loading">
      <LoadingState label="Loading your next view…" />
    </div>
  );
}
