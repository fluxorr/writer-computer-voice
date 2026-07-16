export function Footer() {
  return (
    <footer
      className="sticky z-0 bottom-0 left-0 w-full"
      style={{ height: 320, background: "var(--surface)" }}
    >
      <div className="relative overflow-hidden w-full h-full flex justify-end px-12 text-right items-start py-12">
        <div
          className="flex flex-row gap-12 sm:gap-16 md:gap-24 text-sm md:text-base"
          style={{ color: "var(--ink-secondary)" }}
        >
          <ul className="list-none m-0 p-0 space-y-2">
            <li>
              <a
                href={__WRITER_REPO_URL__}
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors"
                style={{ color: "var(--ink-secondary)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--ink)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--ink-secondary)")}
              >
                GitHub
              </a>
            </li>
            <li>
              <a
                href={`${__WRITER_REPO_URL__}/blob/main/LICENSE`}
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors"
                style={{ color: "var(--ink-secondary)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--ink)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--ink-secondary)")}
              >
                License
              </a>
            </li>
            <li>
              <a
                href={`${__WRITER_REPO_URL__}/releases`}
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors"
                style={{ color: "var(--ink-secondary)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--ink)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--ink-secondary)")}
              >
                Changelog
              </a>
            </li>
          </ul>
          <ul className="list-none m-0 p-0 space-y-2">
            <li>
              <a
                href="#features"
                className="transition-colors"
                style={{ color: "var(--ink-secondary)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--ink)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--ink-secondary)")}
              >
                Features
              </a>
            </li>
            <li>
              <a
                href="#download"
                className="transition-colors"
                style={{ color: "var(--ink-secondary)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--ink)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--ink-secondary)")}
              >
                Download
              </a>
            </li>
            <li>
              <a
                href="#roadmap"
                className="transition-colors"
                style={{ color: "var(--ink-secondary)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--ink)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--ink-secondary)")}
              >
                Roadmap
              </a>
            </li>
          </ul>
        </div>
        <h2
          className="absolute bottom-0 left-0 translate-y-1/3 text-[80px] sm:text-[192px] font-bold leading-none select-none transition-[opacity,text-shadow] duration-500"
          style={{
            color: "var(--ink)",
            opacity: 0.06,
            fontFamily: '"Satoshi", system-ui, sans-serif',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = "0.3";
            e.currentTarget.style.textShadow =
              "0 0 40px rgba(255,242,122,0.15), 0 0 80px rgba(255,242,122,0.1), 0 0 120px rgba(255,242,122,0.05)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = "0.06";
            e.currentTarget.style.textShadow = "none";
          }}
        >
          Speakdown
        </h2>
      </div>
    </footer>
  );
}
