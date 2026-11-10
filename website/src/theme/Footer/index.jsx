import React from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';

export default function Footer() {
  const logo = useBaseUrl('/img/interlock-logo.svg');

  return (
    <footer className="docs-site-footer">
      <div className="docs-footer-shell">
        <a className="docs-footer-brand" href="/interlock/">
          <img src={logo} width="32" height="32" alt="" />
          <span>Interlock</span>
        </a>
        <div className="docs-footer-details">
          <span>MIT licensed</span>
          <span aria-hidden="true">•</span>
          <a href="https://github.com/dgca/interlock">
            github.com/dgca/interlock
          </a>
          <span aria-hidden="true">•</span>
          <span className="docs-footer-author">
            By <a href="https://app.ens.domains/typeof.eth">Dan Cortes</a>
          </span>
        </div>
      </div>
    </footer>
  );
}
