import { appIcon } from "@/lib/app-icon";

// Browser tab icon (replaces the template favicon).
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return appIcon(64);
}
