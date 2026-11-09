import Link from "next/link";
import { LEGAL_UPDATED } from "@/lib/site";

/** Shared frame for the public privacy policy and terms pages. */
export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="space-y-6 pb-6">
      <header className="space-y-1">
        <Link href="/" className="wordmark">
          ArmoryPal
        </Link>
        <h1 className="text-heading-04">{title}</h1>
        <p className="text-body-compact text-muted">Last updated {LEGAL_UPDATED}</p>
      </header>
      <div className="space-y-4 [&_a]:link [&_a]:underline [&_h2]:pt-2 [&_h2]:text-heading-03 [&_li]:ml-6 [&_li]:list-disc [&_ul]:space-y-1">
        {children}
      </div>
    </main>
  );
}
