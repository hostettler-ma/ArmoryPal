import Link from "next/link";

/**
 * Tappable store tile (Noyama teal): storefront icon, name, optional subtitle
 * and detail lines, and a chevron. Use it wherever a store name links
 * somewhere, so stores always look like something you can open.
 *
 * - `trailing` sits beside the header, outside the link (e.g. Add/Remove).
 * - `children` render inside the same frame, below the header, so things that
 *   belong to the store (its events) read as part of it.
 */
export function StoreLink({
  store,
  href = `/stores/${store.id}`,
  subtitle,
  detail,
  trailing,
  children,
}: {
  store: { id: string; name: string };
  href?: string;
  subtitle?: React.ReactNode;
  detail?: React.ReactNode;
  trailing?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-store/40 bg-store-bg text-store-fg">
      <div className="flex items-stretch">
        <Link
          href={href}
          className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-2xl p-3 transition active:scale-[0.99] active:opacity-80"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-store text-store-icon-fg">
            <StorefrontIcon />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{store.name}</span>
            {subtitle && <span className="block truncate text-sm text-store-muted">{subtitle}</span>}
            {detail && <span className="mt-0.5 block truncate text-sm">{detail}</span>}
          </span>
          <span aria-hidden className="shrink-0 text-2xl leading-none text-store-muted">
            ›
          </span>
        </Link>
        {trailing && <div className="flex shrink-0 items-center pr-3">{trailing}</div>}
      </div>
      {children && <div className="space-y-2 px-3 pb-3">{children}</div>}
    </div>
  );
}

function StorefrontIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth={2}>
      <path d="M3 9l1.5-5h15L21 9" strokeLinejoin="round" />
      <path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" strokeLinejoin="round" />
      <path d="M5 11.5V20h14v-8.5" strokeLinejoin="round" />
      <path d="M10 20v-5h4v5" strokeLinejoin="round" />
    </svg>
  );
}
