"use client";

import { useEffect, useState } from "react";

export function Header() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
      style={{
        background: scrolled ? "var(--header-bg)" : "transparent",
        backdropFilter: scrolled ? "blur(20px)" : "none",
        WebkitBackdropFilter: scrolled ? "blur(20px)" : "none",
        borderBottom: scrolled ? "1px solid var(--border)" : "1px solid transparent",
      }}
    >
      <div className="mx-auto flex items-center h-14 gap-6 max-w-6xl px-6">
        <a href="/" className="flex items-center gap-2 shrink-0">
          <img src="/logo.png" alt="" width="20" height="20" className="rounded" />
          <span
            className="text-sm font-semibold"
            style={{ fontFamily: '"Satoshi", system-ui, sans-serif', color: "var(--ink)" }}
          >
            Speakdown
          </span>
        </a>

        <nav className="flex items-center gap-1 ml-auto">
          {[
            { label: "Features", href: "#features" },
            { label: "Download", href: "#download" },
            { label: "Roadmap", href: "#roadmap" },
            { label: "GitHub", href: __WRITER_REPO_URL__, external: true },
          ].map((link) => (
            <a
              key={link.label}
              href={link.href}
              target={link.external ? "_blank" : undefined}
              rel={link.external ? "noopener noreferrer" : undefined}
              className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
              style={{ color: "var(--ink-secondary)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--ink)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--ink-secondary)")}
            >
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
