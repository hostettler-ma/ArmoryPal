import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offline · ArmoryPal" };

/** Shown by the service worker when a page can't load without a connection. */
export default function OfflinePage() {
  return (
    <main className="flex min-h-[80dvh] flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-heading-04">You&apos;re offline</h1>
      <p className="max-w-xs text-muted">
        ArmoryPal needs a connection to show live requests. It&apos;ll pick up where you left off once you&apos;re back
        online.
      </p>
      {/* A plain link (full navigation, not client-side) so the browser retries the network. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/" className="btn btn-primary max-w-xs">
        Try again
      </a>
    </main>
  );
}
