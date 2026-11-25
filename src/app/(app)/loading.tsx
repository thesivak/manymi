import { Skeleton } from "@/components/ui/skeleton";

export default function AppLoading() {
  return (
    <div className="container py-10 space-y-8" aria-busy="true" aria-label="Načítám…">
      <div className="space-y-3">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-12 w-96 max-w-full" />
        <Skeleton className="h-5 w-[32rem] max-w-full" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-[3px] border border-border bg-card p-5 space-y-3">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-8 w-36" />
            <Skeleton className="h-1.5 w-full" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="rounded-[3px] border border-border bg-card p-6 space-y-3">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}
