import { appIcon } from "@/lib/app-icon";

// iOS home-screen icon. iOS applies its own rounded mask, so draw it square.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return appIcon(180, { rounded: false });
}
