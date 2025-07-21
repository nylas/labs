import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      role="status"
      aria-label="Loading..."
      {...props}
    />
  )
}

function SkeletonText({
  className,
  lines = 1,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { lines?: number }) {
  return (
    <div className={cn("space-y-2", className)} role="status" aria-label="Loading text..." {...props}>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          key={index}
          className={cn(
            "h-4",
            index === lines - 1 && lines > 1 ? "w-3/4" : "w-full"
          )}
        />
      ))}
    </div>
  )
}

function SkeletonCard({
  className,
  showAvatar = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { showAvatar?: boolean }) {
  return (
    <div
      className={cn("space-y-3 p-4 border rounded-lg", className)}
      role="status"
      aria-label="Loading card..."
      {...props}
    >
      <div className="flex items-center space-x-3">
        {showAvatar && <Skeleton className="h-12 w-12 rounded-full" />}
        <div className="space-y-2 flex-1">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <SkeletonText lines={2} />
    </div>
  )
}

function SkeletonList({
  className,
  items = 3,
  showAvatar = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { items?: number; showAvatar?: boolean }) {
  return (
    <div className={cn("space-y-3", className)} role="status" aria-label="Loading list..." {...props}>
      {Array.from({ length: items }).map((_, index) => (
        <SkeletonCard key={index} showAvatar={showAvatar} />
      ))}
    </div>
  )
}

export { Skeleton, SkeletonText, SkeletonCard, SkeletonList } 