"use client";

import { useRef, useState } from "react";
import { markGuideSeen } from "@/app/actions/profile";
import { GettingStartedGuide } from "./getting-started";

/** Opens the guide once for a new account; skipping or finishing marks it seen (profiles.guide_seen_at). */
export function FirstRunGuide() {
  const [open, setOpen] = useState(true);
  // The sheet's own close event fires too; save only once.
  const saved = useRef(false);
  return (
    <GettingStartedGuide
      open={open}
      onClose={() => {
        setOpen(false); // close right away; saving happens in the background
        if (!saved.current) {
          saved.current = true;
          void markGuideSeen();
        }
      }}
    />
  );
}
