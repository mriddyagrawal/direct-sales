import { ListSkeleton } from "@/components/ListSkeleton";

// Retailers list — table of ~8 rows. Renders inside the dashboard shell.
export default function Loading() {
  return <ListSkeleton rows={8} />;
}
