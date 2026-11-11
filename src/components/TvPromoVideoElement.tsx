import React, { useEffect, useRef, useState } from 'react';

export interface VideoPlayItem {
  id: string;
  titulo: string;
  previewUrl: string;
}

interface TvPromoVideoElementProps {
  videos: VideoPlayItem[];
  baseUrl: string;
  orientacion: 'HORIZONTAL_16_9' | 'VERTICAL_9_16';
  refreshNonce: number;
  onActiveVideoChange?: (video: VideoPlayItem, index: number) => void;
}

/**
 * Normaliza la URL base (ej. "https//:panel.aryessv.com/tv" -> "https://panel.aryessv.com")
 */
export function normalizeOriginUrl(rawUrl: string): string {
  if (!rawUrl) return 'https://panel.aryessv.com';
  let cleaned = rawUrl
    .trim()
    .replace(/^https\/\/:/i, 'https://')
    .replace(/^http\/\/:/i, 'http://')
    .replace(/^https:\//i, 'https://')
    .replace(/^http:\//i, 'http://');
  if (!/^https?:\/\//i.test(cleaned)) {
    cleaned = `https://${cleaned}`;
  }
  cleaned = cleaned.replace(/\/+$/, '').replace(/\/tv$/i, '');
  cleaned = cleaned.replace(/https?:\/\/(www\.)?arryessv\.com/i, 'https://panel.aryessv.com');
  return cleaned || 'https://panel.aryessv.com';
}

export const TvPromoVideoElement: React.FC<TvPromoVideoElementProps> = ({
  videos,
  baseUrl,
  orientacion,
  refreshNonce,
  onActiveVideoChange,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [videoLoadError, setVideoLoadError] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const safeIndex = videos.length > 0 ? currentIndex % videos.length : 0;
  const activeVideo = videos[safeIndex];

  useEffect(() => {
    setCurrentIndex(0);
    setVideoLoadError(false);
  }, [refreshNonce, videos.length]);

  useEffect(() => {
    if (activeVideo && onActiveVideoChange) {
      onActiveVideoChange(activeVideo, safeIndex);
    }
  }, [activeVideo, safeIndex, onActiveVideoChange]);

  const resolvedVideoUrl = React.useMemo(() => {
    if (!activeVideo || !activeVideo.previewUrl) return '';
    const raw = activeVideo.previewUrl.trim();
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      return raw;
    }
    const cleanOrigin = normalizeOriginUrl(baseUrl);
    const cleanPath = raw.startsWith('/') ? raw : `/${raw}`;
    return `${cleanOrigin}${cleanPath}`;
  }, [activeVideo, baseUrl]);

  // Limpieza de RAM y auto-reproducción idéntica a https://panel.aryessv.com/tv
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !resolvedVideoUrl) return;

    setVideoLoadError(false);
    el.pause();
    el.src = resolvedVideoUrl;
    el.loop = videos.length === 1;
    el.load();

    const playTimer = window.setTimeout(() => {
      el.play().catch(() => {
        // Reintentar reproducción automática
      });
    }, 150);

    // Watchdog cada 5 segundos por si el decodificador se pausa
    const watchdog = window.setInterval(() => {
      if (el.paused && !videoLoadError) {
        el.play().catch(() => {});
      }
    }, 5000);

    return () => {
      window.clearTimeout(playTimer);
      window.clearInterval(watchdog);
    };
  }, [resolvedVideoUrl, videos.length, refreshNonce, videoLoadError]);

  if (!activeVideo) return null;

  return (
    <div
      className={`relative w-full h-full bg-[#1a1a1a] flex items-center justify-center overflow-hidden ${
        orientacion === 'VERTICAL_9_16' ? 'rotate-90 scale-90' : ''
      }`}
    >
      {!videoLoadError ? (
        <video
          key={`${resolvedVideoUrl}-${refreshNonce}`}
          ref={videoRef}
          src={resolvedVideoUrl}
          className="w-full h-full object-cover bg-transparent"
          autoPlay
          muted
          playsInline
          loop={videos.length === 1}
          preload="auto"
          onEnded={() => {
            if (videos.length > 1) {
              setCurrentIndex((prev) => (prev + 1) % videos.length);
            }
          }}
          onError={() => {
            setVideoLoadError(true);
          }}
        />
      ) : (
        <div className="w-full h-full bg-[#0A0F1D] flex flex-col items-center justify-center p-8 text-center">
          <p className="text-xs font-mono text-amber-400 uppercase tracking-widest">
            TÍPICOS MARGOTH · REPRODUCTOR TV
          </p>
          <h3 className="mt-2 text-xl font-bold text-white font-display">
            {activeVideo.titulo || 'Cargando stream de video...'}
          </h3>
          <p className="mt-1 text-xs font-mono text-slate-400 break-all max-w-lg">
            {resolvedVideoUrl}
          </p>
        </div>
      )}
    </div>
  );
};
