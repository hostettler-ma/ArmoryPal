import Link from "next/link";

export type Crumb = { label: string; href: string };

/**
 * Page title with a breadcrumb trail back to Home above it. `trail` lists the
 * ancestors between Home and this page (Home itself is always first), so the
 * number of steps shows how far from Home you are.
 */
export function PageHeader({ title, trail = [], action }: { title: string; trail?: Crumb[]; action?: React.ReactNode }) {
  const crumbs = [{ label: "Home", href: "/" }, ...trail];
  return (
    <header className="space-y-0.5">
      <nav aria-label="Breadcrumb">
        <ol className="flex min-w-0 items-center gap-1 text-sm">
          {crumbs.map((c) => (
            <li key={c.href} className="flex max-w-[45%] min-w-0 items-center gap-1">
              <Link href={c.href} className="flex min-h-8 min-w-0 items-center font-medium text-accent-text">
                <span className="truncate">{c.label}</span>
              </Link>
              <span aria-hidden className="text-muted">
                ›
              </span>
            </li>
          ))}
        </ol>
      </nav>
      <div className="flex min-h-10 items-center gap-3">
        <h1 className="flex-1 truncate text-2xl font-bold">{title}</h1>
        {action}
      </div>
    </header>
  );
}
