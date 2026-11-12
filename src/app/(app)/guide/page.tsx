import Link from "next/link";
import { ShowGuideButton } from "@/components/getting-started";
import { PageHeader } from "@/components/page-header";
import { GUIDE_STEPS } from "@/lib/guide";

/** The getting-started guide, always available from the menu. */
export default function GuidePage() {
  return (
    <main className="space-y-6">
      <PageHeader title="Getting started" />
      <ol className="space-y-3">
        {GUIDE_STEPS.map((step, i) => (
          <li key={step.title} className="card flex gap-3">
            <span
              aria-hidden
              className="flex size-control-sm shrink-0 items-center justify-center rounded-full bg-highlight text-heading-02 text-highlight-foreground"
            >
              {i + 1}
            </span>
            <div className="min-w-0 space-y-1">
              <h2 className="text-heading-02">{step.title}</h2>
              <p className="text-body-compact text-muted">{step.body}</p>
              {step.link && (
                <Link href={step.link.href} className="inline-block text-label link">
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
