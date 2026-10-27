"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

export function FloatingTopbar({ children, className = "" }: { children: ReactNode; className?: string }) {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const update = () => setIsScrolled(window.scrollY > 12);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return <header className={`soto-topbar ${isScrolled ? "is-scrolled" : ""} ${className}`}>{children}</header>;
}
