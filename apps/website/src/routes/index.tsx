import { createFileRoute } from "@tanstack/react-router";

const FEATURES = [
  {
    icon: "🎤",
    title: "Voice-first writing",
    desc: "Dictate naturally and your words appear as clean markdown. On-device, real-time, no cloud.",
  },
  {
    icon: "🔒",
    title: "Local privacy",
    desc: "Everything runs on your machine. Your audio never leaves your computer.",
  },
  {
    icon: "⚡",
    title: "Fast & offline",
    desc: "Cold starts in a fraction of a second. Works without internet — always.",
  },
  {
    icon: "📝",
    title: "Extended markdown",
    desc: "Tables, Mermaid diagrams, frontmatter, wiki links. A real editing environment.",
  },
  {
    icon: "📂",
    title: "Workspace-native",
    desc: "Opens your existing markdown files and folders. No import, no lock-in.",
  },
  {
    icon: "🎯",
    title: "Multi-window",
    desc: "Snappy switch between workspaces. Multiple windows, each with its own state.",
  },
];

const ROADMAP = [
  {
    period: "now" as const,
    tag: "Available now",
    title: "Voice dictation & read-aloud",
    desc: "On-device speech-to-text with multiple engine options, plus text-to-speech with word highlighting.",
  },
  {
    period: "now" as const,
    tag: "Available now",
    title: "Full editor & workspace management",
    desc: "Tables, Mermaid diagrams, frontmatter, gitignore-aware indexing, sidebar file tree.",
  },
  {
    period: "next" as const,
    tag: "Coming soon",
    title: "Tags, metadata & inline media",
    desc: "Flexible tagging, document dates, inline image preview, and Obsidian-style embeds.",
  },
  {
    period: "later" as const,
    tag: "Future idea",
    title: "MCP, CLI & more",
    desc: "Custom tool integration, command-line interface, archive snapshots, and community extensions.",
  },
];

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <>
      <HeroSection />
      <FeaturesSection />
      <DownloadSection />
      <RoadmapSection />
      <OpenSourceSection />
    </>
  );
}

/* ---------- Hero ---------- */

function HeroSection() {
  return (
    <section className="hero">
      <div className="container">
        <div className="hero-marker">
          <span className="hero-marker-dot" />
          Open source &middot; Free forever
        </div>

        <h1>
          A markdown editor that
          <br />
          listens. <span>Speak naturally.</span>
        </h1>

        <p>
          Speakdown brings on-device voice dictation to your writing workflow. Dictate, edit, and
          organise your markdown files — all locally, all offline.
        </p>

        <div className="hero-actions">
          <a className="btn btn--primary" href={__WRITER_DMG_URL__}>
            Download for macOS
          </a>
          <a
            className="btn btn--secondary"
            href={__WRITER_REPO_URL__}
            target="_blank"
            rel="noopener noreferrer"
          >
            View on GitHub
          </a>
        </div>

        <div className="hero-shot">
          <img
            src="/screenshots/editor.png"
            alt="Speakdown editor with voice dictation"
            width="1920"
            height="1206"
          />
        </div>
      </div>
    </section>
  );
}

/* ---------- Features ---------- */

function FeaturesSection() {
  return (
    <section className="section" id="features">
      <div className="container">
        <div className="section-header">
          <span className="section-label">Everything you need</span>
          <h2>Built for writing, not distractions</h2>
          <p>
            Every feature serves a single purpose: helping you write better, faster, and more
            naturally.
          </p>
        </div>

        <div className="features">
          {FEATURES.slice(0, 2).map((f) => (
            <div className="feature" key={f.title}>
              <div className="feature-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}

          <div className="feature-shot">
            <img
              src="/screenshots/editor.png"
              alt="Speakdown editor interface"
              loading="lazy"
              width="1920"
              height="1206"
            />
          </div>

          {FEATURES.slice(2).map((f) => (
            <div className="feature" key={f.title}>
              <div className="feature-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- Download ---------- */

function DownloadSection() {
  return (
    <section className="section section--compact" id="download">
      <div className="container container--narrow">
        <div className="section-header section-header--centered">
          <span className="section-label">Download</span>
          <h2>Get Speakdown</h2>
          <p>Free and open source. No sign-up required.</p>
        </div>

        <a
          className="download-card"
          href={__WRITER_DMG_URL__}
          data-umami-event="Download macOS app"
          data-umami-event-version={__WRITER_VERSION__}
        >
          <div className="download-card-icon">
            <svg width="24" height="24" viewBox="0 0 24 28" fill="none" aria-hidden="true">
              <path
                d="M19.05 21.28c-.98.95-2.05.86-3.08.41-1.07-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.41C4.79 16.25 5.51 8.59 11.05 8.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM14 8.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"
                fill="currentColor"
              />
            </svg>
          </div>
          <div className="download-card-body">
            <h3>macOS</h3>
            <p>Apple Silicon & Intel &middot; macOS 10.15+</p>
          </div>
          <div className="download-card-action">
            <span className="download-version">v{__WRITER_VERSION__}</span>
            <span className="btn btn--primary">Download</span>
          </div>
        </a>

        <div className="download-meta">
          <a href={__WRITER_RELEASES_URL__} target="_blank" rel="noopener noreferrer">
            View all releases on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}

/* ---------- Roadmap ---------- */

function RoadmapSection() {
  return (
    <section className="section" id="roadmap">
      <div className="container container--narrow">
        <div className="section-header">
          <span className="section-label">Roadmap</span>
          <h2>What&rsquo;s next</h2>
          <p>A living look at where Speakdown is headed. No dates, just direction.</p>
        </div>

        <div className="roadmap">
          {ROADMAP.map((item) => (
            <div className={`roadmap-item roadmap-item--${item.period}`} key={item.title}>
              <div className="roadmap-item-dot" />
              <div className="roadmap-item-tag">{item.tag}</div>
              <h3>{item.title}</h3>
              <p>{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- Open Source ---------- */

function OpenSourceSection() {
  return (
    <section className="section section--last" id="opensource">
      <div className="container">
        <div className="section-header section-header--centered">
          <span className="section-label">Open Source</span>
          <h2>Built in the open</h2>
        </div>

        <div className="oss-card">
          <h3>GPL-3.0 Licensed</h3>
          <p>
            Speakdown is free software. The entire source is public on GitHub — inspect it, fork it,
            submit a PR, or just follow along.
          </p>
          <div className="oss-actions">
            <a
              className="btn btn--primary"
              href={__WRITER_REPO_URL__}
              target="_blank"
              rel="noopener noreferrer"
            >
              View source on GitHub
            </a>
            <a
              className="btn btn--secondary"
              href={`${__WRITER_REPO_URL__}/issues`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Report an issue
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
