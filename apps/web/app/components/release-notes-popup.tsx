"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ActiveReleaseNote } from "../../lib/release-notes";

const DISMISSED_LOGIN_KEY = "oraculo-news-dismissed";
const MUTED_RELEASES_KEY = "oraculo-news-muted-releases";

function readMutedReleaseIds() {
  try {
    const stored = JSON.parse(localStorage.getItem(MUTED_RELEASES_KEY) ?? "[]");
    return new Set<string>(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function formatExpiry(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo"
  }).format(new Date(value));
}

export function ReleaseNotesPopup({
  releases,
  loginMarker
}: {
  releases: ActiveReleaseNote[];
  loginMarker: string;
}) {
  const [open, setOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [visibleReleases, setVisibleReleases] = useState<ActiveReleaseNote[]>([]);
  const dismissalMarker = useMemo(
    () => `${loginMarker}:${visibleReleases.map((release) => release.id).join(",")}`,
    [loginMarker, visibleReleases]
  );

  const dismiss = useCallback(() => {
    try {
      if (dontShowAgain) {
        const mutedIds = readMutedReleaseIds();
        visibleReleases.forEach((release) => mutedIds.add(release.id));
        localStorage.setItem(MUTED_RELEASES_KEY, JSON.stringify([...mutedIds]));
      } else {
        localStorage.setItem(DISMISSED_LOGIN_KEY, dismissalMarker);
      }
    } catch {
      // O fechamento continua funcionando quando o storage está bloqueado.
    }
    setOpen(false);
  }, [dismissalMarker, dontShowAgain, visibleReleases]);

  useEffect(() => {
    if (!releases.length) return;
    try {
      const mutedIds = readMutedReleaseIds();
      const eligibleReleases = releases.filter((release) => !mutedIds.has(release.id));
      const eligibleMarker = `${loginMarker}:${eligibleReleases.map((release) => release.id).join(",")}`;
      setVisibleReleases(eligibleReleases);
      setDontShowAgain(false);
      setOpen(eligibleReleases.length > 0 && localStorage.getItem(DISMISSED_LOGIN_KEY) !== eligibleMarker);
    } catch {
      setVisibleReleases(releases);
      setOpen(true);
    }
  }, [loginMarker, releases]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dismiss, open]);

  if (!open || visibleReleases.length === 0) return null;

  return (
    <div className="release-popup-overlay">
      <button className="release-popup-backdrop" type="button" onClick={dismiss} aria-label="Fechar novidades" />
      <section className="release-popup" role="dialog" aria-modal="true" aria-labelledby="release-popup-title">
        <div className="release-popup-head">
          <div className="release-popup-icon" aria-hidden="true">✦</div>
          <div>
            <p className="eyebrow">Atualização recente</p>
            <h2 id="release-popup-title">{visibleReleases[0].title}</h2>
            <p>{visibleReleases[0].summary}</p>
          </div>
          <button className="release-popup-close" type="button" onClick={dismiss} aria-label="Fechar">×</button>
        </div>

        <div className="release-popup-content">
          {visibleReleases.map((release) => (
            <article className="release-note" key={release.id}>
              {visibleReleases.length > 1 && <h3>{release.title}</h3>}
              <div className="release-change-list">
                {release.changes.map((change) => (
                  <div className="release-change" key={`${release.id}-${change.title}`}>
                    <span className="release-change-check" aria-hidden="true">✓</span>
                    <div>
                      <strong>{change.title}</strong>
                      <p>{change.description}</p>
                      {change.href && (
                        <a href={change.href} onClick={dismiss}>{change.linkLabel ?? "Abrir"} →</a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <small className="release-popup-expiry">
                Aviso ativo até {formatExpiry(release.expiresAt)} e exibido novamente no próximo login.
              </small>
            </article>
          ))}
        </div>

        <div className="release-popup-footer">
          <label className="release-popup-preference">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(event) => setDontShowAgain(event.target.checked)}
            />
            <span>
              <strong>
                Não mostrar novamente {visibleReleases.length > 1 ? "estas atualizações" : "esta atualização"}
              </strong>
              <small>O aviso volta quando houver outra novidade.</small>
            </span>
          </label>
          <button type="button" onClick={dismiss} autoFocus>Entendi, continuar</button>
        </div>
      </section>
    </div>
  );
}
