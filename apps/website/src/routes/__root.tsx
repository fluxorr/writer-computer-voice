/// <reference types="vite/client" />

import type { ReactNode } from "react";
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";

import { Header } from "../components/Header";
import { Footer } from "../components/Footer";
import styles from "../styles.css?url";

const TITLE = "Speakdown — Offline voice dictation for your markdown";
const DESCRIPTION =
  "A local-first markdown editor with on-device voice dictation. Speak naturally, write effortlessly. Free and open source.";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1.0" },
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Speakdown" },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://speakdown.byflux.me" },
      { property: "og:image", content: "https://speakdown.byflux.me/og.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "https://speakdown.byflux.me/og.png" },
    ],
    links: [
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "stylesheet", href: styles },
      {
        rel: "preconnect",
        href: "https://api.fontshare.com",
      },
      {
        rel: "stylesheet",
        href: "https://api.fontshare.com/v2/css?f[]=satoshi@300,400,500,600,700&display=swap",
      },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        <Header />
        <main>{children}</main>
        <Footer />
        <script
          defer
          src="https://umami.highpath.studio/script.js"
          data-website-id="7b3faf71-9025-4378-b7dd-4562a9ab55d9"
        />
        <Scripts />
      </body>
    </html>
  );
}
