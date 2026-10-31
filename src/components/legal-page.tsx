import Link from "next/link";
import { LEGAL_UPDATED } from "@/lib/site";

/** Shared frame for the public privacy policy and terms pages. */
export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="space-y-5 pb-6">
      <header className="space-y-1">
        <Link href="/" className="font-logo text-xl font-bold tracking-wide">
          ArmoryPal
        </Link>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-sm text-muted">Last updated {LEGAL_UPDATED}</p>
      </header>
      <div className="space-y-4 leading-relaxed [&_a]:font-medium [&_a]:text-accent-text [&_h2]:pt-2 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1">
        {children}
      </div>
    </main>
  );
}
