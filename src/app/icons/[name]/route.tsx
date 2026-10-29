import { appIcon } from "@/lib/app-icon";

// PWA manifest icons, rendered once at build time.
const ICONS: Record<string, { size: number; padding?: number; rounded?: boolean }> = {
  "192.png": { size: 192 },
  "512.png": { size: 512 },
  "maskable-512.png": { size: 512, padding: 0.12, rounded: false },
};

export const dynamic = "force-static";

export function generateStaticParams() {
  return Object.keys(ICONS).map((name) => ({ name }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const icon = ICONS[(await params).name];
  if (!icon) return new Response("Not found", { status: 404 });
  return appIcon(icon.size, icon);
}
