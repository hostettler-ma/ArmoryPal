"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/actions/profile";

const SECTIONS = [
  { href: "/", label: "Home" },
  { href: "/stores", label: "Find a store" },
  { href: "/notifications", label: "Notifications" },
  { href: "/me", label: "Profile" },
  { href: "/settings/notifications", label: "Notification settings" },
];

/** The section a path belongs to: exact match for Home, longest prefix otherwise. */
function currentSection(pathname: string, hrefs: string[]): string | undefined {
  if (pathname === "/") return "/";
  return hrefs
    .filter((h) => h !== "/" && (pathname === h || pathname.startsWith(`${h}/`)))
    .sort((a, b) => b.length - a.length)[0];
}

/** Burger button that opens a left-side drawer for jumping between sections. */
export function NavMenu({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();
  const sections = isAdmin ? [...SECTIONS, { href: "/admin", label: "Admin" }] : SECTIONS;
  const active = currentSection(pathname, sections.map((s) => s.href));

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Close once a link has navigated.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Menu"
        aria-expanded={open}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-6 w-6 fill-none stroke-current" strokeWidth={2}>
          <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
        </svg>
      </button>
      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === ref.current && setOpen(false)}
        aria-label="Menu"
        className="fixed inset-y-0 left-0 m-0 h-dvh max-h-dvh w-72 max-w-[85vw] bg-surface p-0 text-foreground backdrop:bg-black/50"
      >
        <nav className="flex h-full flex-col gap-1 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="mb-2 flex items-center justify-between gap-3 pl-2">
            <span className="font-logo text-xl font-bold tracking-wide">ArmoryPal</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="h-10 w-10 text-xl text-muted"
            >
              ✕
            </button>
          </div>
          {sections.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              // Same-page taps don't change pathname, so close explicitly too.
              onClick={() => setOpen(false)}
              aria-current={s.href === active ? "page" : undefined}
              className={`flex min-h-12 items-center rounded-xl px-3 font-medium ${s.href === active ? "bg-highlight text-highlight-foreground" : ""}`}
            >
              {s.label}
            </Link>
          ))}
          <form action={signOut} className="mt-auto">
            <button className="flex min-h-12 w-full items-center rounded-xl px-3 font-medium text-danger">Sign out</button>
          </form>
        </nav>
      </dialog>
    </>
  );
}
