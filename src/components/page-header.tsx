import Link from "next/link";

export function PageHeader({ title, back, action }: { title: string; back?: string; action?: React.ReactNode }) {
  return (
    <header className="flex min-h-10 items-center gap-3">
      {back && (
        <Link href={back} aria-label="Back" className="-ml-2 flex h-10 w-10 items-center justify-center text-xl text-muted">
          ←
        </Link>
      )}
      <h1 className="flex-1 truncate text-2xl font-bold">{title}</h1>
      {action}
    </header>
  );
}
