import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Skip static assets, images, and PWA files (manifest, service worker, generated icons),
    // which must load without a session.
    "/((?!_next/static|_next/image|manifest.webmanifest|sw.js|swe-worker|icons/|icon|apple-icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
