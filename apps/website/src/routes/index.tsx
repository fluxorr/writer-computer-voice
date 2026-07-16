import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { motion } from "motion/react";
import { ArrowUpRight, Download } from "lucide-react";
import { ClientOnly } from "../components/ClientOnly";
import VerticalCutReveal from "../components/fancy/text/vertical-cut-reveal";

const Beams = lazy(() => import("../components/reactbits/Beams"));
const Cubes = lazy(() => import("../components/reactbits/Cubes"));

const h2 = {
  fontFamily: '"Satoshi", system-ui, sans-serif',
} as const;

const feats = [
  {
    num: "01",
    title: "Voice-first writing",
    body: "Dictate naturally and your words appear as clean markdown. On-device, real-time, no cloud.",
  },
  {
    num: "02",
    title: "Local privacy",
    body: "Everything runs on your machine. Your audio never leaves your computer.",
  },
  {
    num: "03",
    title: "Fast and offline",
    body: "Cold starts in a fraction of a second. Works without internet, always.",
  },
  {
    num: "04",
    title: "Extended markdown",
    body: "Tables, Mermaid diagrams, frontmatter, wiki links. A real editing environment.",
  },
  {
    num: "05",
    title: "Workspace-native",
    body: "Opens your existing markdown files and folders. No import, no lock-in.",
  },
  {
    num: "06",
    title: "Multi-window",
    body: "Snappy switch between workspaces. Multiple windows, each with its own state.",
  },
];

const principles = [
  {
    title: "Your voice, your text",
    body: "On-device speech-to-text so you can dictate, edit, and organise entirely by voice.",
  },
  {
    title: "Stays on your machine",
    body: "No cloud, no uploads, no privacy concerns. Your audio never leaves your computer.",
  },
  {
    title: "Works with your files",
    body: "Opens existing markdown folders as-is. No import process, no vendor lock-in.",
  },
];

const roadmapItems = [
  {
    status: "live" as const,
    title: "Voice dictation and read-aloud",
    body: "On-device speech-to-text with multiple engine options, plus text-to-speech with word highlighting.",
  },
  {
    status: "live" as const,
    title: "Full editor and workspace management",
    body: "Tables, Mermaid diagrams, frontmatter, gitignore-aware indexing, sidebar file tree.",
  },
  {
    status: "next" as const,
    title: "Tags, metadata and inline media",
    body: "Flexible tagging, document dates, inline image preview, and Obsidian-style embeds.",
  },
  {
    status: "later" as const,
    title: "MCP, CLI and more",
    body: "Custom tool integration, command-line interface, archive snapshots, and community extensions.",
  },
];

export const Route = createFileRoute("/")({
  component: HomePage,
});

function GithubIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

function HomePage() {
  return (
    <div className="relative z-10" style={{ background: "var(--bg)" }}>
      <HeroSection />
      <PrinciplesSection />
      <FeaturesSection />
      <DownloadSection />
      <RoadmapSection />
      <OpenSourceSection />
    </div>
  );
}

function HeroSection() {
  const vcr = { type: "spring", stiffness: 190, damping: 22 } as const;

  return (
    <section
      className="relative min-h-[100dvh] flex flex-col justify-center overflow-hidden"
      style={{ padding: "140px 0 96px" }}
    >
      <ClientOnly>
        <Suspense fallback={null}>
          <div className="absolute inset-0 z-0 opacity-60">
            <Beams
              beamWidth={1.4}
              beamHeight={18}
              beamNumber={36}
              lightColor="#fff27a"
              bgColor="#000000"
              speed={1.5}
              noiseIntensity={1.5}
              scale={0.15}
              rotation={-2}
            />
          </div>
        </Suspense>
      </ClientOnly>

      <div
        className="absolute inset-0 z-[1]"
        style={{
          background: "linear-gradient(to bottom, transparent 0%, transparent 50%, var(--bg) 100%)",
        }}
      />

      <div className="mx-auto w-full max-w-6xl px-6 relative z-[2]">
        <div className="max-w-3xl">
          <h1
            className="text-[clamp(40px,7vw,88px)] font-semibold leading-[1.05] tracking-tight mb-6"
            style={{
              fontFamily: '"Satoshi", system-ui, sans-serif',
              color: "var(--ink)",
              textWrap: "balance",
            }}
          >
            <VerticalCutReveal
              splitBy="words"
              staggerDuration={0.04}
              transition={{ ...vcr, delay: 0.2 }}
            >
              A markdown editor that listens.
            </VerticalCutReveal>
          </h1>

          <p
            className="text-base sm:text-lg max-w-lg mb-10 leading-relaxed"
            style={{ color: "var(--ink-secondary)" }}
          >
            <VerticalCutReveal
              splitBy="words"
              staggerDuration={0.025}
              transition={{ ...vcr, delay: 0.55 }}
            >
              Speakdown brings on-device voice dictation to your writing workflow. Dictate, edit,
              and organise your markdown files all locally, all offline.
            </VerticalCutReveal>
          </p>

          <div
            className="flex items-center gap-3 flex-wrap"
            style={{ overflow: "hidden", animation: "vertical-cut-reveal 0.5s 1.2s both" }}
          >
            <a
              href={__WRITER_DMG_URL__}
              className="inline-flex items-center gap-2 h-10 px-5 rounded-lg text-sm font-medium transition-[background,transform] duration-200 hover:scale-[0.97] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
            >
              <Download size={15} />
              Download for macOS
            </a>
            <a
              href={__WRITER_REPO_URL__}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg text-sm font-medium transition-[color,border-color,transform] duration-200 hover:scale-[0.97] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              style={{ color: "var(--ink-secondary)", border: "1px solid var(--border-hover)" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--ink-secondary)";
                e.currentTarget.style.color = "var(--ink)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--border-hover)";
                e.currentTarget.style.color = "var(--ink-secondary)";
              }}
            >
              <GithubIcon size={15} />
              View on GitHub
            </a>
          </div>
        </div>

        <div
          className="mt-16 rounded-xl overflow-hidden"
          style={{
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-screenshot)",
            animation: "vertical-cut-reveal 0.5s 1.7s both",
          }}
        >
          <img
            src="/screenshots/editor.png"
            alt="Speakdown editor with voice dictation"
            width="1920"
            height="1206"
            className="w-full h-auto block"
          />
        </div>
      </div>
    </section>
  );
}

function PrinciplesSection() {
  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      style={{ padding: "96px 0" }}
    >
      <div className="mx-auto w-full max-w-6xl px-6">
        <h2
          className="text-2xl sm:text-3xl font-semibold tracking-tight mt-2 mb-12"
          style={{ ...h2, color: "var(--ink)" }}
        >
          Three principles
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
          {principles.map((p, i) => (
            <div key={p.title}>
              <span
                className="text-sm font-semibold tabular-nums"
                style={{ color: "var(--accent-text)" }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3
                className="text-base font-semibold mt-3 mb-2"
                style={{ ...h2, color: "var(--ink)" }}
              >
                {p.title}
              </h3>
              <p className="text-sm leading-relaxed" style={{ color: "var(--ink-secondary)" }}>
                {p.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </motion.section>
  );
}

function FeaturesSection() {
  return (
    <motion.section
      id="features"
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      style={{ padding: "96px 0" }}
    >
      <div className="mx-auto w-full max-w-6xl px-6">
        <h2
          className="text-2xl sm:text-3xl font-semibold tracking-tight mb-12"
          style={{ ...h2, color: "var(--ink)" }}
        >
          What it does
        </h2>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-8">
            {feats.map((f) => (
              <div key={f.title}>
                <span
                  className="text-xs font-semibold tabular-nums"
                  style={{ color: "var(--accent-text)" }}
                >
                  {f.num}
                </span>
                <h3
                  className="text-base font-semibold mt-2 mb-1.5"
                  style={{ ...h2, color: "var(--ink)" }}
                >
                  {f.title}
                </h3>
                <p
                  className="text-sm leading-relaxed max-w-sm"
                  style={{ color: "var(--ink-secondary)" }}
                >
                  {f.body}
                </p>
              </div>
            ))}
          </div>

          <ClientOnly>
            <Suspense
              fallback={<div className="w-full aspect-square max-w-md mx-auto lg:ml-auto" />}
            >
              <div
                className="w-full aspect-square max-w-md mx-auto lg:ml-auto"
                style={{ background: "var(--bg)" }}
              >
                <Cubes
                  gridSize={10}
                  maxAngle={30}
                  radius={2.5}
                  faceColor="var(--bg)"
                  borderStyle="var(--cube-border)"
                  rippleColor="var(--accent)"
                  rippleSpeed={1.5}
                  autoAnimate={true}
                  rippleOnClick={true}
                />
              </div>
            </Suspense>
          </ClientOnly>
        </div>

        <div
          className="mt-16 rounded-xl overflow-hidden"
          style={{ border: "1px solid var(--border)", boxShadow: "var(--shadow-screenshot)" }}
        >
          <img
            src="/screenshots/editor.png"
            alt="Speakdown editor interface"
            loading="lazy"
            width="1920"
            height="1206"
            className="w-full h-auto block"
          />
        </div>
      </div>
    </motion.section>
  );
}

function DownloadSection() {
  return (
    <motion.section
      id="download"
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      style={{ padding: "96px 0" }}
    >
      <div className="mx-auto w-full max-w-3xl px-6">
        <div className="text-center mb-12">
          <h2
            className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3"
            style={{ ...h2, color: "var(--ink)" }}
          >
            Get started
          </h2>
          <p className="text-sm" style={{ color: "var(--ink-secondary)" }}>
            Free. Open source. No sign-up required.
          </p>
        </div>

        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <div
            className="flex items-center gap-1.5 px-4 py-2.5"
            style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}
          >
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: "#ef4444" }} />
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: "#eab308" }} />
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: "#22c55e" }} />
            <span className="text-xs ml-3 font-mono" style={{ color: "var(--ink-tertiary)" }}>
              ~/download
            </span>
          </div>

          <div className="p-5 sm:p-6 space-y-4" style={{ background: "#0a0a0c" }}>
            <div className="flex items-center gap-3 pt-1">
              <a
                href={__WRITER_DMG_URL__}
                className="inline-flex items-center gap-2 h-10 px-5 rounded-lg text-sm font-medium transition-[background,transform] duration-200 hover:scale-[0.97] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
                data-umami-event="Download macOS app"
                data-umami-event-version={__WRITER_VERSION__}
              >
                <Download size={15} />
                Download Speakdown
              </a>
              <div className="flex items-center gap-2">
                <span
                  className="text-[11px] font-semibold px-2 py-0.5 rounded tabular-nums"
                  style={{ background: "var(--accent-dim)", color: "var(--accent-text)" }}
                >
                  v{__WRITER_VERSION__}
                </span>
                <span className="text-xs" style={{ color: "var(--ink-tertiary)" }}>
                  macOS 10.15+
                </span>
              </div>
            </div>

            <div
              className="flex items-center gap-3 pt-1"
              style={{ borderTop: "1px solid var(--border)" }}
            >
              <a
                href={__WRITER_RELEASES_URL__}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                style={{ color: "var(--ink-tertiary)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--ink-secondary)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--ink-tertiary)")}
              >
                See all releases
                <ArrowUpRight size={11} />
              </a>
            </div>
          </div>
        </div>
      </div>
    </motion.section>
  );
}

function RoadmapSection() {
  return (
    <motion.section
      id="roadmap"
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      style={{ padding: "96px 0" }}
    >
      <div className="mx-auto w-full max-w-3xl px-6">
        <div className="mb-12">
          <h2
            className="text-2xl sm:text-3xl font-semibold tracking-tight mb-2"
            style={{ ...h2, color: "var(--ink)" }}
          >
            What's next
          </h2>
          <p className="text-sm" style={{ color: "var(--ink-secondary)" }}>
            A living roadmap. No dates, just direction.
          </p>
        </div>

        <div className="relative">
          {roadmapItems.map((item, i) => {
            const isLive = item.status === "live";
            const isNext = item.status === "next";
            const iconColor = isLive
              ? "#22c55e"
              : isNext
                ? "var(--accent-text)"
                : "var(--ink-tertiary)";

            return (
              <div key={item.title} className="relative flex gap-5 pb-10 last:pb-0">
                <div className="flex flex-col items-center">
                  <div
                    className="w-2.5 h-2.5 rounded-full z-10 mt-1.5"
                    style={{ background: iconColor }}
                  />
                  {i < roadmapItems.length - 1 && (
                    <div className="w-px flex-1 mt-1.5" style={{ background: "var(--border)" }} />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <h3
                      className="text-sm font-semibold"
                      style={{
                        ...h2,
                        color: isLive
                          ? "var(--ink)"
                          : isNext
                            ? "var(--ink)"
                            : "var(--ink-secondary)",
                      }}
                    >
                      {item.title}
                    </h3>
                    <span
                      className={`inline-flex items-center gap-1 text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded ${
                        isLive ? "text-green-500" : ""
                      }`}
                      style={{
                        background: isLive
                          ? "rgba(34,197,94,0.1)"
                          : isNext
                            ? "var(--accent-dim)"
                            : "transparent",
                        border: isLive
                          ? "1px solid rgba(34,197,94,0.2)"
                          : isNext
                            ? "1px solid rgba(255,242,122,0.2)"
                            : "1px solid var(--border)",
                        color: isLive
                          ? "#22c55e"
                          : isNext
                            ? "var(--accent-text)"
                            : "var(--ink-tertiary)",
                      }}
                    >
                      {isLive && (
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                      {isLive ? "Live" : isNext ? "Next" : "Planned"}
                    </span>
                  </div>

                  <p className="text-xs leading-relaxed" style={{ color: "var(--ink-secondary)" }}>
                    {item.body}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </motion.section>
  );
}

function OpenSourceSection() {
  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      style={{ padding: "64px 0 96px" }}
    >
      <div className="mx-auto w-full max-w-3xl px-6">
        <div className="mb-8">
          <h2
            className="text-2xl sm:text-3xl font-semibold tracking-tight mb-2"
            style={{ ...h2, color: "var(--ink)" }}
          >
            Built in the open
          </h2>
          <p className="text-sm" style={{ color: "var(--ink-secondary)" }}>
            Free software, freely shared.
          </p>
        </div>

        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <div
            className="flex items-center gap-2 px-4 py-2.5"
            style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}
          >
            <GithubIcon size={14} />
            <span className="text-xs font-mono ml-1" style={{ color: "var(--ink-secondary)" }}>
              <span style={{ color: "var(--ink-tertiary)" }}>fluxorr/</span>speakdown
            </span>
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded ml-auto"
              style={{ background: "var(--accent-dim)", color: "var(--accent-text)" }}
            >
              GPL-3.0
            </span>
          </div>

          <div className="p-6 sm:p-8" style={{ background: "var(--bg)" }}>
            <p className="text-sm leading-relaxed mb-6" style={{ color: "var(--ink-secondary)" }}>
              Speakdown is free and open source. The entire source is on GitHub — inspect it, fork
              it, submit a PR, or just follow along.
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <a
                href={__WRITER_REPO_URL__}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 h-10 px-5 rounded-lg text-sm font-medium transition-[background,transform] duration-200 hover:scale-[0.97] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
              >
                <GithubIcon size={15} />
                View source
              </a>
              <a
                href={`${__WRITER_REPO_URL__}/issues`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg text-sm font-medium transition-[color,border-color,transform] duration-200 hover:scale-[0.97] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                style={{ color: "var(--ink-secondary)", border: "1px solid var(--border-hover)" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--ink-secondary)";
                  e.currentTarget.style.color = "var(--ink)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--border-hover)";
                  e.currentTarget.style.color = "var(--ink-secondary)";
                }}
              >
                Report an issue
              </a>
            </div>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
