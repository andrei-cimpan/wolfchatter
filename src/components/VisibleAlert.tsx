"use client";

import { useEffect, useRef } from "react";

/**
 * An error the reader must see. On a short screen the panel scrolls, and this can appear beyond
 * what it shows, so a failed post or room would look like nothing happened.
 */
export function VisibleAlert({ message, className }: { message: string; className: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest" });
  }, [message]);
  return (
    <p ref={ref} role="alert" className={className}>
      {message}
    </p>
  );
}
