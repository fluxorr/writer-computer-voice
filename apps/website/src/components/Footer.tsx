export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-links">
          <a href={__WRITER_REPO_URL__} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          <a
            href={`${__WRITER_REPO_URL__}/blob/main/LICENSE`}
            target="_blank"
            rel="noopener noreferrer"
          >
            License
          </a>
          <a href={`${__WRITER_REPO_URL__}/releases`} target="_blank" rel="noopener noreferrer">
            Changelog
          </a>
        </div>
        <span className="footer-copyright">Open source. Free forever.</span>
      </div>
    </footer>
  );
}
