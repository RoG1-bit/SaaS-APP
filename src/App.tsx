import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Maximize2,
  Minimize2,
  Power,
  RefreshCw,
  RotateCcw,
  Server,
  Tv,
  Unlink,
} from 'lucide-react';
import {
  ANDROID_PROJECT_FILES,
  ANDROID_TV_CONSTANTS,
} from './data/androidProjectFiles';
import {
  TvPromoVideoElement,
  VideoPlayItem,
  normalizeOriginUrl,
} from './components/TvPromoVideoElement';
import { downloadAndroidStudioProjectZip } from './utils/exportAndroidZip';

interface SyncResponseData {
  ok: boolean;
  horaElSalvador: string;
  diaElSalvador: string;
  pantalla: {
    id: string;
    nombre?: string;
    sucursal?: string;
    orientacion: 'HORIZONTAL_16_9' | 'VERTICAL_9_16';
  };
  videoAsignado: VideoPlayItem | null;
  playlistVideos: VideoPlayItem[];
}

interface ApiTraceEntry {
  id: string;
  timestamp: string;
  method: 'GET' | 'POST' | 'DELETE';
  endpoint: string;
  status: number;
  summary: string;
}

type ActiveSection = 'kiosk' | 'kotlin' | 'contract';

function normalizeDisplayTvUrl(raw?: string | null): string {
  if (!raw) return 'https://panel.aryessv.com/tv';
  let cleaned = raw
    .trim()
    .replace(/^https\/\/:/i, 'https://')
    .replace(/^http\/\/:/i, 'http://')
    .replace(/^https:\//i, 'https://')
    .replace(/^http:\//i, 'http://');
  if (!/^https?:\/\//i.test(cleaned)) {
    cleaned = `https://${cleaned}`;
  }
  if (/arryessv\.com/i.test(cleaned)) {
    return 'https://panel.aryessv.com/tv';
  }
  return cleaned;
}

export default function App() {
  const [activeSection, setActiveSection] = useState<ActiveSection>('kiosk');

  // Preferencias persistentes equivalentes a SharedPreferences("margoth_prefs")
  const [baseUrl, setBaseUrl] = useState<string>(() => {
    const saved = localStorage.getItem(ANDROID_TV_CONSTANTS.PREF_KEY_BASE_URL);
    const normalized = normalizeDisplayTvUrl(saved);
    localStorage.setItem(ANDROID_TV_CONSTANTS.PREF_KEY_BASE_URL, normalized);
    return normalized;
  });

  const [pantallaId, setPantallaId] = useState<string | null>(() => {
    const saved = localStorage.getItem(ANDROID_TV_CONSTANTS.PREF_KEY_TV_ID);
    // Si había un ID de prueba local anterior ("tv-482910" o "tv-margoth-escalon-01"), limpiarlo para enlazar con panel.aryessv.com real
    if (saved === 'tv-482910' || saved === 'tv-margoth-escalon-01') {
      localStorage.removeItem(ANDROID_TV_CONSTANTS.PREF_KEY_TV_ID);
      return null;
    }
    return saved && saved.trim().length > 0 ? saved.trim() : null;
  });

  // Estado del Reproductor Kiosco TV conectado a https://panel.aryessv.com/tv
  const [isAppExited, setIsAppExited] = useState<boolean>(false);
  const [pairingCode, setPairingCode] = useState<string>('------');
  const [pairingPollCount, setPairingPollCount] = useState<number>(0);
  const [syncData, setSyncData] = useState<SyncResponseData | null>(null);
  const [nextSyncInSec, setNextSyncInSec] = useState<number>(30);
  const [refreshNonce, setRefreshNonce] = useState<number>(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [activePlayingVideo, setActivePlayingVideo] = useState<VideoPlayItem | null>(null);
  const [standbyImgError, setStandbyImgError] = useState<boolean>(false);
  const [isFullscreenKiosk, setIsFullscreenKiosk] = useState<boolean>(false);

  // Modal de Control Remoto (Salir Sí/No + Refrescar F5 + Auto-Cierre 15s)
  const [isControlModalOpen, setIsControlModalOpen] = useState<boolean>(false);
  const [focusedModalIndex, setFocusedModalIndex] = useState<number>(0);
  const [modalCountdown, setModalCountdown] = useState<number>(15);
  const [isEditingBaseUrl, setIsEditingBaseUrl] = useState<boolean>(false);
  const [tempBaseUrlInput, setTempBaseUrlInput] = useState<string>(baseUrl);

  // Visor de código nativo Kotlin y exportación ZIP
  const [selectedFileIndex, setSelectedFileIndex] = useState<number>(0);
  const [copiedFilePath, setCopiedFilePath] = useState<string | null>(null);
  const [isExportingZip, setIsExportingZip] = useState<boolean>(false);

  // Bitácora real de peticiones HTTP hacia https://panel.aryessv.com
  const [apiLogs, setApiLogs] = useState<ApiTraceEntry[]>([]);

  const tvViewportRef = useRef<HTMLDivElement | null>(null);
  const apiOrigin = normalizeOriginUrl(baseUrl);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3500);
  }, []);

  const appendApiLog = useCallback(
    (
      method: 'GET' | 'POST' | 'DELETE',
      endpoint: string,
      status: number,
      summary: string
    ) => {
      const now = new Date();
      const timeStr = now.toTimeString().split(' ')[0];
      setApiLogs((prev) => [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: timeStr,
          method,
          endpoint,
          status,
          summary,
        },
        ...prev.slice(0, 14),
      ]);
    },
    []
  );

  /**
   * Conecta directamente con https://panel.aryessv.com a través del backend server.ts
   * enviando X-Base-Url para evitar problemas de CORS en el navegador.
   */
  const callProductionApi = useCallback(
    async (
      path: string,
      method: 'GET' | 'POST' | 'DELETE' = 'GET',
      body?: Record<string, unknown>
    ): Promise<{ status: number; data: any }> => {
      try {
        const res = await fetch(path, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'X-Base-Url': apiOrigin,
          },
          body: method !== 'GET' && body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json().catch(() => ({}));
        return { status: res.status, data };
      } catch (err) {
        return {
          status: 503,
          data: { ok: false, error: err instanceof Error ? err.message : 'Error de red' },
        };
      }
    },
    [apiOrigin]
  );

  // WakeLock real del navegador
  useEffect(() => {
    let wakeLockSentinel: any = null;
    async function acquireBrowserWakeLock() {
      try {
        if ('wakeLock' in navigator && !isAppExited) {
          wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
        }
      } catch {
        // Silencioso en iframes restringidos
      }
    }
    acquireBrowserWakeLock();
    return () => {
      if (wakeLockSentinel) {
        wakeLockSentinel.release().catch(() => {});
      }
    };
  }, [isAppExited]);

  // Guardar o limpiar margoth_tv_id en localStorage (SharedPreferences "margoth_prefs")
  const savePantallaId = useCallback((newId: string | null) => {
    if (newId && newId.trim().length > 0) {
      localStorage.setItem(ANDROID_TV_CONSTANTS.PREF_KEY_TV_ID, newId.trim());
      setPantallaId(newId.trim());
    } else {
      localStorage.removeItem(ANDROID_TV_CONSTANTS.PREF_KEY_TV_ID);
      setPantallaId(null);
    }
  }, []);

  // Solicitar código de 6 dígitos REAL a https://panel.aryessv.com/api/pairing/request-code
  const requestNewPairingCode = useCallback(async () => {
    if (isAppExited) return;
    setPairingCode('------');
    const hardwarePayload = {
      modeloHardware: 'Android TV - Típicos Margoth Kiosk',
    };
    const { status, data } = await callProductionApi(
      '/api/pairing/request-code',
      'POST',
      hardwarePayload
    );

    const code = data?.sesionTV?.codigoSeisDigitos || data?.codigoSeisDigitos;
    if (status >= 200 && status < 300 && code) {
      setPairingCode(code);
      appendApiLog(
        'POST',
        `${apiOrigin}/api/pairing/request-code`,
        status,
        `Código generado en panel.aryessv.com: ${code} (ESPERANDO_VINCULACION)`
      );
    } else {
      appendApiLog(
        'POST',
        `${apiOrigin}/api/pairing/request-code`,
        status,
        'Reintentando conexión con panel.aryessv.com...'
      );
    }
  }, [apiOrigin, appendApiLog, callProductionApi, isAppExited]);

  // Ejecutar sincronización horaria y latido cada 30s con https://panel.aryessv.com/api/tv-player/sync/{pantallaId}
  const executePlayerSync = useCallback(
    async (targetId: string, isManualF5 = false) => {
      if (isAppExited || !targetId) return;
      const endpoint = `/api/tv-player/sync/${targetId}`;
      const { status, data } = await callProductionApi(endpoint, 'GET');

      if (status === 404) {
        appendApiLog(
          'GET',
          `${apiOrigin}${endpoint}`,
          404,
          'HTTP 404 PANTALLA_NO_ENCONTRADA → Borrando margoth_tv_id y pidiendo nuevo código a panel.aryessv.com'
        );
        showToast('Pantalla no encontrada en panel.aryessv.com (404). Generando nuevo código...');
        setSyncData(null);
        savePantallaId(null);
        return;
      }

      if (status >= 200 && status < 300 && data?.ok) {
        setSyncData(data as SyncResponseData);
        setNextSyncInSec(30);
        const videoCount = data.playlistVideos?.length || (data.videoAsignado ? 1 : 0);
        appendApiLog(
          'GET',
          `${apiOrigin}${endpoint}`,
          200,
          `${isManualF5 ? '[F5] ' : ''}Sync OK (${data.horaElSalvador || ''} ${
            data.diaElSalvador || ''
          }) · ${
            videoCount > 0 ? `${videoCount} video(s) activos` : 'En espera de horario (fondo.webp)'
          }`
        );
      }
    },
    [apiOrigin, appendApiLog, callProductionApi, isAppExited, savePantallaId, showToast]
  );

  // Estado 1: Si pantallaId es null, solicitar código de 6 dígitos a https://panel.aryessv.com
  useEffect(() => {
    if (isAppExited || pantallaId) return;
    requestNewPairingCode();
  }, [isAppExited, pantallaId, requestNewPairingCode]);

  // Consultar cada 2.5s GET https://panel.aryessv.com/api/pairing/status/{codigoSeisDigitos}
  useEffect(() => {
    if (isAppExited || pantallaId || pairingCode === '------') return;

    const interval = window.setInterval(async () => {
      setPairingPollCount((c) => c + 1);
      const endpoint = `/api/pairing/status/${pairingCode}`;
      const { status, data } = await callProductionApi(endpoint, 'GET');

      if (status === 404) {
        appendApiLog(
          'GET',
          `${apiOrigin}${endpoint}`,
          404,
          'Código expirado en panel.aryessv.com → Solicitando nuevo código de 6 dígitos'
        );
        requestNewPairingCode();
        return;
      }

      const sesion = data?.sesionTV || data;
      const linkedId =
        sesion?.dispositivoVinculado?.id ||
        data?.dispositivo?.id ||
        data?.pantalla?.id;

      if (
        status >= 200 &&
        status < 300 &&
        sesion?.estado === 'VINCULADA' &&
        linkedId
      ) {
        appendApiLog(
          'GET',
          `${apiOrigin}${endpoint}`,
          200,
          `¡VINCULADA EN PANEL.ARYESSV.COM! → margoth_tv_id="${linkedId}"`
        );
        showToast(`¡Pantalla vinculada desde panel.aryessv.com! (${linkedId})`);
        savePantallaId(linkedId);
      }
    }, ANDROID_TV_CONSTANTS.PAIRING_POLL_MS);

    return () => window.clearInterval(interval);
  }, [
    apiOrigin,
    appendApiLog,
    callProductionApi,
    isAppExited,
    pairingCode,
    pantallaId,
    requestNewPairingCode,
    savePantallaId,
    showToast,
  ]);

  // Estado 2: Si pantallaId existe, sincronizar de inmediato y cada 30 segundos
  useEffect(() => {
    if (isAppExited || !pantallaId) return;

    executePlayerSync(pantallaId, false);
    setNextSyncInSec(30);

    const syncInterval = window.setInterval(() => {
      executePlayerSync(pantallaId, false);
    }, ANDROID_TV_CONSTANTS.SYNC_HEARTBEAT_MS);

    const tickerInterval = window.setInterval(() => {
      setNextSyncInSec((prev) => (prev > 1 ? prev - 1 : 30));
    }, 1000);

    return () => {
      window.clearInterval(syncInterval);
      window.clearInterval(tickerInterval);
    };
  }, [executePlayerSync, isAppExited, pantallaId]);

  // Auto-cierre de seguridad de 15 segundos del Modal de Control Remoto
  useEffect(() => {
    if (!isControlModalOpen) return;

    setModalCountdown(ANDROID_TV_CONSTANTS.MODAL_AUTO_CLOSE_SEC);
    const timer = window.setInterval(() => {
      setModalCountdown((prev) => {
        if (prev <= 1) {
          setIsControlModalOpen(false);
          setIsEditingBaseUrl(false);
          return 15;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isControlModalOpen]);

  const openRemoteControlModal = useCallback(() => {
    if (isAppExited) return;
    setFocusedModalIndex(0);
    setModalCountdown(15);
    setIsEditingBaseUrl(false);
    setTempBaseUrlInput(baseUrl);
    setIsControlModalOpen(true);
  }, [baseUrl, isAppExited]);

  // Acción Botón 1: "🔄 Refrescar Pantalla (F5)"
  const handleHardRefreshF5 = useCallback(() => {
    setIsControlModalOpen(false);
    setIsEditingBaseUrl(false);
    showToast('Sincronizando y refrescando pantalla...');
    setRefreshNonce((n) => n + 1);

    if (pantallaId) {
      executePlayerSync(pantallaId, true);
    } else {
      requestNewPairingCode();
    }
  }, [executePlayerSync, pantallaId, requestNewPairingCode, showToast]);

  // Acción Botón 2: "No, continuar reproduciendo"
  const handleContinuePlaying = useCallback(() => {
    setIsControlModalOpen(false);
    setIsEditingBaseUrl(false);
  }, []);

  // Acción Botón 3: "Sí, salir de la aplicación"
  const handleDisconnectAndExitApp = useCallback(async () => {
    setIsControlModalOpen(false);
    setIsEditingBaseUrl(false);

    if (pantallaId) {
      const endpoint = `/api/tv-player/disconnect/${pantallaId}`;
      const { status } = await callProductionApi(endpoint, 'POST', {});
      appendApiLog(
        'POST',
        `${apiOrigin}${endpoint}`,
        status,
        'Desconexión limpia enviada a panel.aryessv.com · Deteniendo KeepAliveService y ExoPlayer'
      );
    }
    setIsAppExited(true);
    showToast('Aplicación cerrada (finishAffinity).');
  }, [apiOrigin, appendApiLog, callProductionApi, pantallaId, showToast]);

  const handleSimulateTvBootCompleted = useCallback(() => {
    setIsAppExited(false);
    appendApiLog(
      'POST',
      'Intent.ACTION_BOOT_COMPLETED',
      200,
      'BootReceiver → Iniciando KeepAliveService + MainActivity (FLAG_ACTIVITY_NEW_TASK)'
    );
    showToast('BootReceiver: Auto-arranque ejecutado al encender el televisor');
  }, [appendApiLog, showToast]);

  // Escuchar teclado físico para simular el Control Remoto de Android TV
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditingBaseUrl) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'F5') {
        e.preventDefault();
        handleHardRefreshF5();
        return;
      }

      if (!isControlModalOpen) {
        if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'Enter') {
          e.preventDefault();
          openRemoteControlModal();
        }
        return;
      }

      setModalCountdown(15);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedModalIndex((prev) => (prev + 1) % 4);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedModalIndex((prev) => (prev - 1 + 4) % 4);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleContinuePlaying();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (focusedModalIndex === 0) handleHardRefreshF5();
        else if (focusedModalIndex === 1) handleContinuePlaying();
        else if (focusedModalIndex === 2) handleDisconnectAndExitApp();
        else if (focusedModalIndex === 3) setIsEditingBaseUrl(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    focusedModalIndex,
    handleContinuePlaying,
    handleDisconnectAndExitApp,
    handleHardRefreshF5,
    isControlModalOpen,
    isEditingBaseUrl,
    openRemoteControlModal,
  ]);

  const toggleFullscreenTv = () => {
    if (!tvViewportRef.current) return;
    if (!document.fullscreenElement) {
      tvViewportRef.current.requestFullscreen().catch(() => {});
      setIsFullscreenKiosk(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreenKiosk(false);
    }
  };

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreenKiosk(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const handleSaveBaseUrl = () => {
    const normalized = normalizeDisplayTvUrl(tempBaseUrlInput);
    setBaseUrl(normalized);
    localStorage.setItem(ANDROID_TV_CONSTANTS.PREF_KEY_BASE_URL, normalized);
    setIsEditingBaseUrl(false);
    setIsControlModalOpen(false);
    showToast(`URL actualizada a ${normalized}`);
    setRefreshNonce((n) => n + 1);
  };

  const handleUnlinkLocalScreen = () => {
    savePantallaId(null);
    setSyncData(null);
    showToast('Pantalla desvinculada localmente. Solicitando nuevo código a panel.aryessv.com...');
  };

  const handleCopyFile = async (content: string, path: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedFilePath(path);
      window.setTimeout(() => setCopiedFilePath(null), 2000);
    } catch {
      showToast('Copiado al portapapeles');
    }
  };

  const handleDownloadZip = async () => {
    setIsExportingZip(true);
    try {
      await downloadAndroidStudioProjectZip();
      showToast('Proyecto Android Studio (.ZIP) descargado correctamente.');
    } finally {
      setIsExportingZip(false);
    }
  };

  const videosToPlay: VideoPlayItem[] = React.useMemo(() => {
    if (!syncData) return [];
    if (syncData.playlistVideos && syncData.playlistVideos.length > 0) {
      return syncData.playlistVideos;
    }
    if (syncData.videoAsignado) {
      return [syncData.videoAsignado];
    }
    return [];
  }, [syncData]);

  const currentFile = ANDROID_PROJECT_FILES[selectedFileIndex] || ANDROID_PROJECT_FILES[0];

  return (
    <div className="min-h-screen bg-[#0A0F1D] text-slate-100 flex flex-col">
      {/* Top Bar Contract: 3 zonas exactas separadas por gap-8 */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-slate-800/90 bg-[#0A0F1D]/95 sticky top-0 z-30">
        <a
          href="#kiosk"
          onClick={(e) => {
            e.preventDefault();
            setActiveSection('kiosk');
          }}
          className="text-lg font-bold tracking-tight text-white font-display whitespace-nowrap shrink-0"
        >
          Típicos Margoth · Reproductor TV
        </a>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300">
          <button
            type="button"
            onClick={() => setActiveSection('kiosk')}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 underline-offset-8 cursor-pointer ${
              activeSection === 'kiosk' ? 'text-amber-400 underline' : ''
            }`}
          >
            Reproductor Kiosco TV
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('kotlin')}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 underline-offset-8 cursor-pointer ${
              activeSection === 'kotlin' ? 'text-amber-400 underline' : ''
            }`}
          >
            Código Nativo Android TV
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('contract')}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 underline-offset-8 cursor-pointer ${
              activeSection === 'contract' ? 'text-amber-400 underline' : ''
            }`}
          >
            Contrato API y Energía
          </button>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handleDownloadZip}
            disabled={isExportingZip}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-400 rounded-lg hover:bg-amber-300 transition-colors whitespace-nowrap shrink-0 flex items-center gap-2 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>
              {isExportingZip ? 'Empaquetando ZIP...' : 'Descargar Proyecto Android (.ZIP)'}
            </span>
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-[1400px] w-full mx-auto px-4 sm:px-6 py-6 space-y-8">
        {/* Cabecera contextual */}
        <section className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-slate-800/80 pb-5">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 font-mono tabular-nums">
              <span>URL TV: {baseUrl}</span>
              <span aria-hidden="true">·</span>
              <span>API: {apiOrigin}</span>
              <span aria-hidden="true">·</span>
              <span>
                margoth_tv_id: {pantallaId ? `"${pantallaId}"` : 'null (Esperando vinculación)'}
              </span>
            </div>
            <h1 className="mt-1.5 text-2xl sm:text-3xl font-bold tracking-tight text-white font-display">
              Reproductor TV Conectado en Vivo a panel.aryessv.com
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={openRemoteControlModal}
              className="px-3.5 py-2 text-xs font-medium text-slate-100 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Menú Control Remoto (OK / BACK)
            </button>
            <button
              type="button"
              onClick={handleHardRefreshF5}
              className="px-3.5 py-2 text-xs font-medium text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refrescar Pantalla (F5)</span>
            </button>
            <button
              type="button"
              onClick={toggleFullscreenTv}
              className="px-3.5 py-2 text-xs font-medium text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
            >
              {isFullscreenKiosk ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5" />
                  <span>Salir de Pantalla Completa</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>Pantalla Completa TV</span>
                </>
              )}
            </button>
          </div>
        </section>

        {/* VISTA 1: PANTALLA ANDROID TV + CONTROL REMOTO */}
        {activeSection === 'kiosk' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Monitor Android TV 16:9 (8 columnas) */}
            <div className="lg:col-span-8 space-y-4">
              <div
                ref={tvViewportRef}
                className="relative w-full aspect-video rounded-xl overflow-hidden border border-slate-700/90 bg-[#1a1a1a] shadow-2xl select-none"
              >
                {/* Toast Nativo Android TV */}
                {toastMessage && (
                  <div className="absolute top-5 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-lg bg-slate-900/95 border border-slate-600 text-xs font-medium text-slate-100 shadow-lg">
                    {toastMessage}
                  </div>
                )}

                {isAppExited ? (
                  <div className="w-full h-full bg-[#050811] flex flex-col items-center justify-center p-8 text-center">
                    <Power className="w-12 h-12 text-slate-500 mb-3" />
                    <h2 className="text-xl font-bold text-white font-display">
                      Aplicación Cerrada Limpiamente (finishAffinity)
                    </h2>
                    <p className="mt-1.5 text-sm text-slate-400 max-w-md">
                      Se envió POST {apiOrigin}/api/tv-player/disconnect/{pantallaId || 'tv'} y se
                      liberaron KeepAliveService y ExoPlayer.
                    </p>
                    <button
                      type="button"
                      onClick={handleSimulateTvBootCompleted}
                      className="mt-6 px-5 py-2.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-semibold text-xs transition-colors cursor-pointer"
                    >
                      Simular Encendido de TV (BootReceiver → Auto-Arranque)
                    </button>
                  </div>
                ) : !pantallaId ? (
                  /* ESTADO 1: PANTALLA NO VINCULADA (Conectado en vivo a https://panel.aryessv.com/api/pairing/request-code) */
                  <div
                    onClick={openRemoteControlModal}
                    className="w-full h-full bg-[#0A0F1D] flex flex-col items-center justify-center p-6 sm:p-10 text-center cursor-pointer"
                  >
                    <p className="text-xs sm:text-sm font-bold tracking-[0.16em] text-slate-400 uppercase">
                      TÍPICOS MARGOTH · ENLACE DE PANTALLA
                    </p>

                    <div className="my-6 sm:my-8 px-8 sm:px-14 py-5 sm:py-7 rounded-2xl bg-black border-2 border-[#334155]">
                      <span className="font-mono font-black text-4xl sm:text-6xl md:text-[72px] leading-none tracking-[0.2em] text-slate-50 tabular-nums">
                        {pairingCode}
                      </span>
                    </div>

                    <p className="text-sm sm:text-base text-slate-300 max-w-xl leading-relaxed">
                      Ingresa este código de 6 dígitos en la sección{' '}
                      <strong className="text-white font-semibold">
                        Pantallas → Vincular TV
                      </strong>{' '}
                      de tu panel administrativo (
                      <span className="font-mono text-amber-400">panel.aryessv.com</span>).
                    </p>

                    <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs text-slate-400 font-mono tabular-nums">
                      <span>
                        GET {apiOrigin}/api/pairing/status/{pairingCode} (cada 2.5s)
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>Consultas: {pairingPollCount}</span>
                      <span aria-hidden="true">·</span>
                      <span>keepScreenOn=true</span>
                    </div>
                  </div>
                ) : videosToPlay.length > 0 ? (
                  /* ESTADO 2A: PANTALLA VINCULADA CON VIDEO / PLAYLIST EN HORARIO */
                  <div
                    onClick={openRemoteControlModal}
                    className="w-full h-full relative cursor-pointer"
                  >
                    <TvPromoVideoElement
                      videos={videosToPlay}
                      baseUrl={apiOrigin}
                      orientacion={syncData?.pantalla?.orientacion || 'HORIZONTAL_16_9'}
                      refreshNonce={refreshNonce}
                      onActiveVideoChange={(vid) => setActivePlayingVideo(vid)}
                    />
                  </div>
                ) : (
                  /* ESTADO 2B: PANTALLA VINCULADA EN ESPERA DE HORARIO (fondo.webp en #1a1a1a object-contain igual a panel.aryessv.com/tv) */
                  <div
                    onClick={openRemoteControlModal}
                    className="relative w-full h-full bg-[#1a1a1a] flex items-center justify-center overflow-hidden cursor-pointer"
                  >
                    {!standbyImgError ? (
                      <img
                        src={ANDROID_TV_CONSTANTS.STANDBY_IMAGE_URL}
                        alt="Típicos Margoth · Fondo Corporativo en Espera"
                        referrerPolicy="no-referrer"
                        onError={() => setStandbyImgError(true)}
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <div className="w-full h-full bg-[#1a1a1a] flex flex-col items-center justify-center p-8 text-center">
                        <p className="text-xs font-mono tracking-widest text-amber-400 uppercase">
                          TÍPICOS MARGOTH · MODO ESPERA DE HORARIO
                        </p>
                        <h3 className="mt-2 text-2xl sm:text-3xl font-bold text-white font-display">
                          Sabores Tradicionales de El Salvador
                        </h3>
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-4 flex items-center justify-between text-xs text-slate-200 font-mono tabular-nums">
                      <span>
                        En espera de programación ({syncData?.horaElSalvador || '--:--'} ·{' '}
                        {syncData?.diaElSalvador || 'sv'})
                      </span>
                      <span>keepScreenOn = true</span>
                    </div>
                  </div>
                )}

                {/* MODAL DE CONTROL REMOTO (SALIR SÍ/NO + BOTÓN REFRESCAR F5 + AUTO-CIERRE 15S) */}
                {isControlModalOpen && (
                  <div className="absolute inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
                    <div className="w-full max-w-[490px] rounded-2xl bg-[#0F172A] border-2 border-[#334155] p-6 shadow-2xl">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h3 className="text-lg sm:text-xl font-bold text-white font-display">
                            Opciones de Pantalla · Típicos Margoth
                          </h3>
                          <p className="mt-1 text-xs sm:text-sm text-slate-300">
                            ¿Deseas refrescar el contenido o salir de la aplicación?
                          </p>
                        </div>
                        <span className="font-mono text-xs text-amber-400 tabular-nums shrink-0">
                          {modalCountdown}s
                        </span>
                      </div>

                      {!isEditingBaseUrl ? (
                        <div className="mt-5 space-y-2.5">
                          <button
                            type="button"
                            onMouseEnter={() => setFocusedModalIndex(0)}
                            onClick={handleHardRefreshF5}
                            className={`w-full text-left px-4 py-3 rounded-xl text-sm font-semibold transition-all cursor-pointer flex items-center justify-between ${
                              focusedModalIndex === 0
                                ? 'bg-blue-600 text-white border-2 border-blue-300 shadow-md'
                                : 'bg-slate-800/90 text-slate-200 border border-slate-700'
                            }`}
                          >
                            <span>🔄 Refrescar Pantalla (F5)</span>
                            {focusedModalIndex === 0 && (
                              <span className="text-[11px] font-mono text-blue-100">
                                FOCO D-PAD
                              </span>
                            )}
                          </button>

                          <button
                            type="button"
                            onMouseEnter={() => setFocusedModalIndex(1)}
                            onClick={handleContinuePlaying}
                            className={`w-full text-left px-4 py-3 rounded-xl text-sm font-medium transition-all cursor-pointer flex items-center justify-between ${
                              focusedModalIndex === 1
                                ? 'bg-slate-700 text-white border-2 border-white shadow-md'
                                : 'bg-slate-800/90 text-slate-200 border border-slate-700'
                            }`}
                          >
                            <span>No, continuar reproduciendo</span>
                            {focusedModalIndex === 1 && (
                              <span className="text-[11px] font-mono text-slate-200">
                                FOCO D-PAD
                              </span>
                            )}
                          </button>

                          <button
                            type="button"
                            onMouseEnter={() => setFocusedModalIndex(2)}
                            onClick={handleDisconnectAndExitApp}
                            className={`w-full text-left px-4 py-3 rounded-xl text-sm font-semibold transition-all cursor-pointer flex items-center justify-between ${
                              focusedModalIndex === 2
                                ? 'bg-red-600 text-white border-2 border-red-300 shadow-md'
                                : 'bg-red-950/70 text-red-200 border border-red-800/80'
                            }`}
                          >
                            <span>Sí, salir de la aplicación</span>
                            {focusedModalIndex === 2 && (
                              <span className="text-[11px] font-mono text-red-100">
                                FOCO D-PAD
                              </span>
                            )}
                          </button>

                          <button
                            type="button"
                            onMouseEnter={() => setFocusedModalIndex(3)}
                            onClick={() => setIsEditingBaseUrl(true)}
                            className={`w-full text-left px-4 py-2.5 rounded-xl text-xs font-mono transition-all cursor-pointer flex items-center justify-between ${
                              focusedModalIndex === 3
                                ? 'bg-slate-800 text-amber-300 border-2 border-amber-400'
                                : 'bg-slate-900/90 text-slate-400 border border-slate-800'
                            }`}
                          >
                            <span className="truncate">Servidor: {baseUrl}</span>
                            <span className="shrink-0 ml-2">Cambiar</span>
                          </button>
                        </div>
                      ) : (
                        <div className="mt-5 space-y-3">
                          <label className="block text-xs font-medium text-slate-300">
                            URL del Reproductor / Servidor (BASE_URL)
                          </label>
                          <input
                            type="text"
                            value={tempBaseUrlInput}
                            onChange={(e) => setTempBaseUrlInput(e.target.value)}
                            placeholder="https://panel.aryessv.com/tv"
                            className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-700 text-sm font-mono text-white focus:outline-none focus:border-amber-400"
                          />
                          <div className="flex items-center justify-end gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => setIsEditingBaseUrl(false)}
                              className="px-3.5 py-2 rounded-lg bg-slate-800 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                            >
                              Cancelar
                            </button>
                            <button
                              type="button"
                              onClick={handleSaveBaseUrl}
                              className="px-4 py-2 rounded-lg bg-amber-400 text-xs font-semibold text-slate-950 hover:bg-amber-300 cursor-pointer"
                            >
                              Guardar URL
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400 font-mono tabular-nums">
                        <span>Usa Flechas ↑/↓ y OK en el Control Remoto</span>
                        <span>Auto-cierre de seguridad en {modalCountdown}s</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Barra inferior de estado real del reproductor */}
              <div className="rounded-xl bg-slate-900/70 border border-slate-800 p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
                <div className="flex flex-wrap items-center gap-2 text-slate-300 font-mono tabular-nums">
                  <span>
                    Estado:{' '}
                    <strong className="text-white">
                      {isAppExited
                        ? 'CERRADA'
                        : pantallaId
                        ? 'ESTADO 2 · VINCULADA EN PANEL.ARYESSV.COM'
                        : 'ESTADO 1 · ESPERANDO ENLACE EN PANEL.ARYESSV.COM'}
                    </strong>
                  </span>
                  {syncData?.horaElSalvador && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        Hora El Salvador: {syncData.horaElSalvador} ({syncData.diaElSalvador})
                      </span>
                    </>
                  )}
                  {pantallaId && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>Próximo sync en {nextSyncInSec}s</span>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-3 text-slate-400 font-mono text-xs tabular-nums">
                  <span>
                    Contenido:{' '}
                    <strong className="text-amber-300">
                      {!pantallaId
                        ? `Código ${pairingCode}`
                        : activePlayingVideo && videosToPlay.length > 0
                        ? activePlayingVideo.titulo
                        : 'En espera (fondo.webp)'}
                    </strong>
                  </span>
                </div>
              </div>
            </div>

            {/* Columna Derecha (4 columnas): Estado de Conexión Real con panel.aryessv.com + Control Remoto D-Pad */}
            <div className="lg:col-span-4 space-y-5">
              {/* Estado de Conexión en Producción con https://panel.aryessv.com/tv */}
              <div className="rounded-xl bg-slate-900/85 border border-slate-700 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-white font-display flex items-center gap-2">
                    <Server className="w-4 h-4 text-amber-400" />
                    <span>Conexión en Vivo · panel.aryessv.com</span>
                  </h2>
                </div>

                {!pantallaId ? (
                  <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
                    <p>
                      El código{' '}
                      <strong className="font-mono text-sm text-amber-400">{pairingCode}</strong>{' '}
                      fue generado directamente en tu servidor de producción{' '}
                      <code className="font-mono text-white">https://panel.aryessv.com</code>.
                    </p>
                    <ol className="list-decimal list-inside space-y-1.5 text-slate-300">
                      <li>
                        Abre tu panel administrativo en{' '}
                        <a
                          href="https://panel.aryessv.com"
                          target="_blank"
                          rel="noreferrer"
                          className="text-amber-400 underline inline-flex items-center gap-1"
                        >
                          <span>panel.aryessv.com</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </li>
                      <li>
                        Ve a <strong className="text-white">Pantallas → Vincular TV</strong>.
                      </li>
                      <li>
                        Ingresa el código{' '}
                        <strong className="font-mono text-amber-400">{pairingCode}</strong>.
                      </li>
                      <li>
                        Esta pantalla detectará el enlace automáticamente en menos de 2.5 segundos.
                      </li>
                    </ol>

                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={requestNewPairingCode}
                        className="w-full py-2.5 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-semibold text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Solicitar Nuevo Código a panel.aryessv.com</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 text-xs">
                    <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
                      <span className="text-slate-400">ID Pantalla (margoth_tv_id):</span>
                      <code className="font-mono font-semibold text-emerald-400">{pantallaId}</code>
                    </div>

                    <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                      <div className="flex justify-between">
                        <span className="text-slate-400">Orientación:</span>
                        <span className="font-mono text-slate-200">
                          {syncData?.pantalla?.orientacion || 'HORIZONTAL_16_9'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Videos en Playlist:</span>
                        <span className="font-mono text-amber-400">{videosToPlay.length}</span>
                      </div>
                    </div>

                    <div className="pt-2 flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={handleHardRefreshF5}
                        className="w-full py-2.5 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Sincronizar Ahora con panel.aryessv.com (F5)</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleUnlinkLocalScreen}
                        className="w-full py-2 px-3 rounded-lg bg-red-950/60 hover:bg-red-900/60 border border-red-800/70 text-red-200 text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Unlink className="w-3.5 h-3.5" />
                        <span>Olvidar ID local y pedir nuevo código</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Control Remoto Virtual Android TV (D-Pad) */}
              <div className="rounded-xl bg-slate-900/75 border border-slate-800 p-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-white font-display">
                    Control Remoto Android TV
                  </h2>
                  <span className="text-xs font-mono text-slate-400">D-Pad Nativo</span>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Navega con las flechas, el botón OK/Centro o el botón Atrás (BACK).
                </p>

                <div className="my-4 flex flex-col items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!isControlModalOpen) openRemoteControlModal();
                      else {
                        setModalCountdown(15);
                        setFocusedModalIndex((prev) => (prev - 1 + 4) % 4);
                      }
                    }}
                    className="w-12 h-10 rounded-t-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 flex items-center justify-center text-slate-200 cursor-pointer"
                    title="D-Pad Arriba"
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (!isControlModalOpen) openRemoteControlModal();
                        else setModalCountdown(15);
                      }}
                      className="w-12 h-12 rounded-l-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 flex items-center justify-center text-slate-200 cursor-pointer"
                      title="D-Pad Izquierda"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (!isControlModalOpen) {
                          openRemoteControlModal();
                        } else {
                          if (focusedModalIndex === 0) handleHardRefreshF5();
                          else if (focusedModalIndex === 1) handleContinuePlaying();
                          else if (focusedModalIndex === 2) handleDisconnectAndExitApp();
                          else if (focusedModalIndex === 3) setIsEditingBaseUrl(true);
                        }
                      }}
                      className="w-16 h-16 rounded-full bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs flex flex-col items-center justify-center shadow-md cursor-pointer"
                      title="DPAD_CENTER / OK"
                    >
                      <span>OK</span>
                      <span className="text-[10px] font-mono">CENTER</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (!isControlModalOpen) openRemoteControlModal();
                        else setModalCountdown(15);
                      }}
                      className="w-12 h-12 rounded-r-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 flex items-center justify-center text-slate-200 cursor-pointer"
                      title="D-Pad Derecha"
                    >
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (!isControlModalOpen) openRemoteControlModal();
                      else {
                        setModalCountdown(15);
                        setFocusedModalIndex((prev) => (prev + 1) % 4);
                      }
                    }}
                    className="w-12 h-10 rounded-b-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 flex items-center justify-center text-slate-200 cursor-pointer"
                    title="D-Pad Abajo"
                  >
                    <ArrowDown className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!isControlModalOpen) openRemoteControlModal();
                      else handleContinuePlaying();
                    }}
                    className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>ATRÁS</span>
                  </button>

                  <button
                    type="button"
                    onClick={openRemoteControlModal}
                    className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Tv className="w-3.5 h-3.5" />
                    <span>MENÚ</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleHardRefreshF5}
                    className="px-3 py-2 rounded-lg bg-blue-600/25 hover:bg-blue-600/35 border border-blue-500/40 text-xs font-semibold text-blue-300 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>F5</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VISTA 2: CÓDIGO FUENTE NATIVO ANDROID TV */}
        {activeSection === 'kotlin' && (
          <section className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-white font-display">
                  Proyecto Nativo Android TV (Kotlin + Media3 ExoPlayer)
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  Configurado con <code className="font-mono text-amber-300">https://panel.aryessv.com</code>{' '}
                  y listo para compilar en Android Studio.
                </p>
              </div>
              <button
                type="button"
                onClick={handleDownloadZip}
                className="px-4 py-2.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-semibold text-xs flex items-center gap-2 shrink-0 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Descargar Proyecto Completo (.ZIP)</span>
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-4 rounded-xl bg-slate-900/75 border border-slate-800 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-800 text-xs font-semibold text-slate-300">
                  Estructura del Proyecto Android Studio
                </div>
                <div className="divide-y divide-slate-800/80">
                  {ANDROID_PROJECT_FILES.map((file, idx) => (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => setSelectedFileIndex(idx)}
                      className={`w-full text-left px-4 py-3.5 transition-colors cursor-pointer flex flex-col gap-1 ${
                        selectedFileIndex === idx
                          ? 'bg-slate-800/90 text-white'
                          : 'hover:bg-slate-900 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-amber-400 flex items-center gap-1.5">
                          <Code2 className="w-3.5 h-3.5 shrink-0" />
                          <span>{file.filename}</span>
                        </span>
                        <span className="text-[11px] font-mono text-slate-400">
                          {file.language.toUpperCase()}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-slate-400 truncate">
                        {file.path}
                      </span>
                      <p className="text-xs text-slate-300 leading-relaxed mt-0.5">
                        {file.description}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="lg:col-span-8 rounded-xl bg-slate-900/85 border border-slate-800 overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between gap-4 bg-slate-950/60">
                  <div>
                    <div className="font-mono text-xs font-semibold text-white">
                      {currentFile.path}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {currentFile.description}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopyFile(currentFile.content, currentFile.path)}
                    className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200 flex items-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    {copiedFilePath === currentFile.path ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Copiado</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copiar Archivo</span>
                      </>
                    )}
                  </button>
                </div>

                <pre className="p-5 text-xs font-mono text-slate-200 overflow-x-auto max-h-[640px] leading-relaxed bg-[#060A14]">
                  <code>{currentFile.content}</code>
                </pre>
              </div>
            </div>
          </section>
        )}

        {/* VISTA 3: ESPECIFICACIÓN DE ENERGÍA 24/7 Y CONTRATO DE LA API */}
        {activeSection === 'contract' && (
          <section className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="rounded-xl bg-slate-900/75 border border-slate-800 p-5 space-y-2">
                <span className="text-xs font-mono text-amber-400">
                  01. Auto-Arranque &amp; Kiosco HOME
                </span>
                <h3 className="text-base font-bold text-white font-display">
                  BootReceiver + Categorías Leanback
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Escucha <code className="font-mono">BOOT_COMPLETED</code>,{' '}
                  <code className="font-mono">QUICKBOOT_POWERON</code>,{' '}
                  <code className="font-mono">LOCKED_BOOT_COMPLETED</code> y{' '}
                  <code className="font-mono">MY_PACKAGE_REPLACED</code>. Inicia{' '}
                  <code className="font-mono">KeepAliveService</code> y lanza{' '}
                  <code className="font-mono">MainActivity</code>.
                </p>
              </div>

              <div className="rounded-xl bg-slate-900/75 border border-slate-800 p-5 space-y-2">
                <span className="text-xs font-mono text-amber-400">
                  02. Cero Protector de Pantalla
                </span>
                <h3 className="text-base font-bold text-white font-display">
                  WakeLock + WifiLock + Doze Whitelist
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Mantiene <code className="font-mono">FLAG_KEEP_SCREEN_ON</code>,{' '}
                  <code className="font-mono">rootView.keepScreenOn = true</code> y{' '}
                  <code className="font-mono">playerView.keepScreenOn = true</code> incluso cuando
                  está en espera de horario (<code className="font-mono">fondo.webp</code>).
                </p>
              </div>

              <div className="rounded-xl bg-slate-900/75 border border-slate-800 p-5 space-y-2">
                <span className="text-xs font-mono text-amber-400">
                  03. Control Remoto D-Pad (F5 + 15s)
                </span>
                <h3 className="text-base font-bold text-white font-display">
                  Modal con Foco D-Pad y Auto-Cierre
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Intercepta <code className="font-mono">BACK</code>,{' '}
                  <code className="font-mono">DPAD_CENTER</code> y{' '}
                  <code className="font-mono">MENU</code>. Ofrece el botón{' '}
                  <strong className="text-white">Refrescar Pantalla (F5)</strong> con foco por
                  defecto y cierre automático tras 15s de inactividad.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Bitácora en Vivo del Contrato API con https://panel.aryessv.com */}
        <section className="rounded-xl bg-slate-900/75 border border-slate-800 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-white">
              <span>Tráfico HTTP en Tiempo Real</span>
              <span aria-hidden="true" className="text-slate-600">
                ·
              </span>
              <span className="font-mono text-amber-400 font-normal">{apiOrigin}</span>
            </div>
            <button
              type="button"
              onClick={() => setApiLogs([])}
              className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
            >
              Limpiar registros
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/40">
                  <th className="py-2.5 px-4 font-medium">Hora</th>
                  <th className="py-2.5 px-4 font-medium">Método</th>
                  <th className="py-2.5 px-4 font-medium">Endpoint</th>
                  <th className="py-2.5 px-4 font-medium text-right">HTTP</th>
                  <th className="py-2.5 px-4 font-medium">Respuesta de panel.aryessv.com</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
                {apiLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 px-4 text-center text-slate-500">
                      Conectando con {apiOrigin}...
                    </td>
                  </tr>
                ) : (
                  apiLogs.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-800/30">
                      <td className="py-2.5 px-4 text-slate-400 whitespace-nowrap">
                        {entry.timestamp}
                      </td>
                      <td className="py-2.5 px-4 font-semibold text-amber-400 whitespace-nowrap">
                        {entry.method}
                      </td>
                      <td className="py-2.5 px-4 text-slate-200 whitespace-nowrap">
                        {entry.endpoint}
                      </td>
                      <td
                        className={`py-2.5 px-4 text-right font-semibold whitespace-nowrap ${
                          entry.status === 404
                            ? 'text-red-400'
                            : entry.status >= 200 && entry.status < 300
                            ? 'text-emerald-400'
                            : 'text-amber-400'
                        }`}
                      >
                        {entry.status}
                      </td>
                      <td className="py-2.5 px-4 text-slate-300 font-sans">
                        {entry.summary}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <footer className="mt-auto border-t border-slate-800/80 px-6 py-4 text-xs text-slate-500 flex flex-wrap items-center justify-between gap-4 max-w-[1400px] w-full mx-auto">
        <span>Típicos Margoth · Reproductor TV ({baseUrl})</span>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setActiveSection('kotlin')}
            className="hover:text-slate-300 transition-colors cursor-pointer"
          >
            Ver Código Fuente Kotlin
          </button>
          <button
            type="button"
            onClick={handleDownloadZip}
            className="hover:text-slate-300 transition-colors cursor-pointer"
          >
            Descargar ZIP Android Studio
          </button>
        </div>
      </footer>
    </div>
  );
}
