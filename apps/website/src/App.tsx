import { AppleGlyph, WriterMark } from "./components/Mark";

const FEATURES = [
  { label: "Private", description: "all your documents live in your computer" },
  { label: "Blazing fast", description: "cold starts takes a fraction of a second" },
  { label: "Extended markdown", description: "mermaid charts, tables and HTML" },
  { label: "Multiwindow", description: "snappy switch between multiple workspaces" },
  { label: "Frontmatter", description: "YAML metadata support built-in" },
];

const SCREENSHOTS = [
  { id: "editor", alt: "Writer editor view" },
  { id: "palette", alt: "Writer command palette" },
  { id: "multi-window", alt: "Writer multi-window layout" },
];

export function App() {
  return (
    <div className="page">
      <main className="hero">
        <header className="site-header">
          <a className="brand" href="/" aria-label="Writer">
            <WriterMark size={18} />
            <span className="brand-rule" aria-hidden="true" />
          </a>
          <nav className="site-nav">
            <a
              className="pill pill-ghost"
              href="https://x.com/joelbqz"
              target="_blank"
              rel="noopener noreferrer"
              data-umami-event="Open updates"
            >
              Updates
            </a>
            <a
              className="pill pill-outline"
              href={__WRITER_REPO_URL__}
              target="_blank"
              rel="noopener noreferrer"
              data-umami-event="Open GitHub"
            >
              GitHub
            </a>
          </nav>
        </header>

        <h1 className="headline">Fast and lightweight app for your workspace's markdown files</h1>

        <div className="cta">
          <a
            className="download"
            href={__WRITER_DMG_URL__}
            data-umami-event="Download macOS app"
            data-umami-event-version={__WRITER_VERSION__}
          >
            <AppleGlyph size={14} />
            <span>Download for MacOS</span>
          </a>
          <span className="alpha-pill">Alpha</span>
          <span className="version">v{__WRITER_VERSION__}</span>
        </div>

        <p className="caption">Free and open source. Forever</p>

        <ul className="features">
          {FEATURES.map(({ label, description }) => (
            <li className="feature" key={label}>
              <span className="feature-label">{label}</span>
              <span className="feature-desc">{description}</span>
            </li>
          ))}
        </ul>
      </main>

      <aside className="screenshots" aria-hidden="true">
        {SCREENSHOTS.map(({ id, alt }) => (
          <div className="shot" key={id} role="img" aria-label={alt} />
        ))}
      </aside>
    </div>
  );
}
