import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function SkeletonRow({
  nameWidth,
  indent = 0,
}: {
  nameWidth: string;
  indent?: number;
}) {
  return (
    <div
      className="w-full min-w-0 px-1 py-0.5"
      style={{ paddingLeft: `${indent}px` }}
    >
      <div className="flex h-8 min-w-0 w-full items-center gap-1.5 rounded-md px-1">
        <Skeleton className="size-4 shrink-0 rounded" />
        <Skeleton className={cn("h-3.5 shrink-0 rounded", nameWidth)} />
      </div>
    </div>
  );
}

export function FileTreeSkeleton() {
  return (
    <>
      <SkeletonRow nameWidth="w-24" indent={8} />
      <SkeletonRow nameWidth="w-28" indent={22} />
      <SkeletonRow nameWidth="w-20" indent={22} />
      <SkeletonRow nameWidth="w-32" indent={22} />
      <SkeletonRow nameWidth="w-20" indent={8} />
      <SkeletonRow nameWidth="w-24" indent={22} />
      <SkeletonRow nameWidth="w-16" indent={22} />
    </>
  );
}
