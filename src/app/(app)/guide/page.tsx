import Link from "next/link";
import { ShowGuideButton } from "@/components/getting-started";
import { PageHeader } from "@/components/page-header";
import { GUIDE_STEPS } from "@/lib/guide";

/** The getting-started guide, always available from the menu. */
export default function GuidePage() {
  return (
    <main className="space-y-5">
      <PageHeader title="Getting started" />
      <ol className="space-y-3">
        {GUIDE_STEPS.map((step, i) => (
          <li key={step.title} className="card flex gap-3">
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-highlight font-bold text-highlight-foreground"
            >
              {i + 1}
            </span>
            <div className="min-w-0 space-y-1">
              <h2 className="font-semibold">{step.title}</h2>
              <p className="text-sm leading-relaxed text-muted">{step.body}</p>
              {step.link && (
                <Link href={step.link.href} className="inline-block text-sm font-medium text-accent-text">
                  {step.link.label} ›
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>
      <ShowGuideButton />
    </main>
  );
}
