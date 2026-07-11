import { ListSkeleton } from "@/components/ListSkeleton";

// Users list — ~5 rows. Renders inside the dashboard shell.
export default function Loading() {
  return <ListSkeleton rows={5} />;
}
