'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';

const PROJECTS = [
  {
    id: 'hierarchical-memory',
    label: 'OpenClaw skill: hierarchical-memory-storage',
    href: 'https://clawhub.ai/shivaclaw/hierarchical-memory-storage',
    external: true,
  },
  {
    id: 'global-oracle',
    label: 'Global Macroeconomic Oracle',
    href: '/oracle?mode=g',
    external: false,
  },
  {
    id: 'portfolio-risk',
    label: 'Portfolio Risk Manager',
    href: '/oracle?mode=p',
    external: false,
  },
  {
    id: 'susy',
    label: 'Searching for SUSY',
    href: 'https://gemini.google.com/share/2d35b47a1fc5',
    external: true,
  },
] as const;

export default function HomePage() {
  const [open, setOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  function handleBlur() {
    // Short delay so click inside registers before close
    setTimeout(() => setOpen(false), 120);
  }

  return (
    <main className="home-page">
      {/* ── splash ─────────────────────────────────────────────────────── */}
      <div className="splash-wrap">
        <img
          src="/splash.png"
          alt="Portable G and Claw of Shiva — Om and Jolly Roger sigil"
          className="splash-img"
        />
        <div className="splash-overlay" />
      </div>

      {/* ── content ────────────────────────────────────────────────────── */}
      <section className="home-content">
        <h1 className="home-title">Portable G and Claw of Shiva</h1>
        <p className="home-sub">
          First-principles tools for understanding capital, risk, and reality.
        </p>

        {/* dropdown */}
        <div className="dropdown-wrap" ref={dropRef} onBlur={handleBlur}>
          <button
            className="dropdown-trigger"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            <span>Active Projects</span>
            <span className="dropdown-chevron" aria-hidden>
              {open ? '▲' : '▼'}
            </span>
          </button>

          {open && (
            <ul className="dropdown-menu" role="listbox">
              {PROJECTS.map((p) =>
                p.external ? (
                  <li key={p.id} role="option">
                    <a
                      href={p.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="dropdown-item"
                    >
                      {p.label}
                      <span className="ext-icon" aria-hidden>↗</span>
                    </a>
                  </li>
                ) : (
                  <li key={p.id} role="option">
                    <Link href={p.href} className="dropdown-item" onClick={() => setOpen(false)}>
                      {p.label}
                    </Link>
                  </li>
                )
              )}
            </ul>
          )}
        </div>
      </section>

      <style>{`
        .home-page {
          position: relative;
          min-height: 100dvh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }

        .splash-wrap {
          position: fixed;
          inset: 0;
          z-index: 0;
        }

        .splash-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: center 30%;
          display: block;
        }

        .splash-overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(
            to bottom,
            rgba(7, 10, 18, 0.50) 0%,
            rgba(7, 10, 18, 0.72) 40%,
            rgba(7, 10, 18, 0.88) 100%
          );
        }

        .home-content {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 18px;
          padding: 32px 24px 48px;
          text-align: center;
          max-width: 600px;
          width: 100%;
        }

        .home-title {
          margin: 0;
          font-size: clamp(26px, 5vw, 46px);
          font-weight: 700;
          letter-spacing: -0.02em;
          line-height: 1.15;
          background: linear-gradient(135deg, #fff 30%, #c8a96e 70%, #6ee7e7 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          text-fill-color: transparent;
        }

        .home-sub {
          margin: 0;
          font-size: 14px;
          color: rgba(255,255,255,0.55);
          line-height: 1.6;
          max-width: 440px;
        }

        .dropdown-wrap {
          position: relative;
          width: 100%;
          max-width: 380px;
        }

        .dropdown-trigger {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.18);
          color: rgba(255,255,255,0.92);
          border-radius: 10px;
          padding: 12px 18px;
          font-size: 14px;
          font-weight: 600;
          letter-spacing: 0.03em;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s;
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }

        .dropdown-trigger:hover {
          background: rgba(255,255,255,0.13);
          border-color: rgba(255,255,255,0.28);
        }

        .dropdown-chevron {
          font-size: 10px;
          opacity: 0.6;
        }

        .dropdown-menu {
          position: absolute;
          top: calc(100% + 6px);
          left: 0;
          right: 0;
          list-style: none;
          margin: 0;
          padding: 6px;
          background: rgba(11, 16, 32, 0.96);
          border: 1px solid rgba(255,255,255,0.14);
          border-radius: 12px;
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          box-shadow: 0 12px 40px rgba(0,0,0,0.55);
          z-index: 100;
          animation: dd-in 0.12s ease;
        }

        @keyframes dd-in {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .dropdown-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          width: 100%;
          padding: 10px 14px;
          border-radius: 8px;
          font-size: 13px;
          color: rgba(255,255,255,0.80);
          text-decoration: none;
          transition: background 0.1s, color 0.1s;
          cursor: pointer;
        }

        .dropdown-item:hover {
          background: rgba(255,255,255,0.10);
          color: rgba(255,255,255,0.96);
        }

        .ext-icon {
          font-size: 11px;
          opacity: 0.45;
          flex-shrink: 0;
        }
      `}</style>
    </main>
  );
}
