import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATE_FILE_PATH = path.join(__dirname, '.margoth-tv-state.json');

const PRODUCTION_VPS_ORIGIN = 'https://panel.aryessv.com';

/**
 * Normaliza cualquier variante de URL (ej. "https//:panel.aryessv.com/tv" o "https://panel.aryessv.com/tv")
 * al origen limpio de la API ("https://panel.aryessv.com").
 */
function normalizeToApiOrigin(rawUrl?: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return PRODUCTION_VPS_ORIGIN;
  let cleaned = rawUrl
    .trim()
    .replace(/^https\/\/:/i, 'https://')
    .replace(/^http\/\/:/i, 'http://')
    .replace(/^https:\//i, 'https://')
    .replace(/^http:\//i, 'http://');

  if (!/^https?:\/\//i.test(cleaned)) {
    cleaned = `https://${cleaned}`;
  }
  cleaned = cleaned.replace(/\/+$/, '');
  // Si termina en /tv (como https://panel.aryessv.com/tv), quitar el sufijo /tv para las rutas /api/*
  cleaned = cleaned.replace(/\/tv$/i, '');
  // Si por error escribieron arryessv.com (con doble r), corregir automáticamente a panel.aryessv.com
  cleaned = cleaned.replace(/https?:\/\/(www\.)?arryessv\.com/i, PRODUCTION_VPS_ORIGIN);
  return cleaned || PRODUCTION_VPS_ORIGIN;
}

interface VideoItem {
  id: string;
  titulo: string;
  duracionSegundos: number;
  horario: string;
  previewUrl: string;
}

interface DispositivoTV {
  id: string;
  nombre: string;
  sucursal: string;
  orientacion: 'HORIZONTAL_16_9' | 'VERTICAL_9_16';
  modeloHardware: string;
  modoReproduccion: 'VIDEO_UNICO' | 'PLAYLIST' | 'EN_ESPERA_FONDO';
  videoAsignadoId: string | null;
  playlistIds: string[];
  conectado: boolean;
  ultimoLatido: number;
}

interface SesionPairing {
  codigoSeisDigitos: string;
  estado: 'ESPERANDO_VINCULACION' | 'VINCULADA';
  modeloHardware: string;
  resolucionDetectada: string;
  creadoEn: number;
  expiraEn: number;
  dispositivoVinculado?: {
    id: string;
    nombre: string;
    sucursal: string;
    orientacion: 'HORIZONTAL_16_9' | 'VERTICAL_9_16';
  };
}

const CATALOGO_VIDEOS: VideoItem[] = [
  {
    id: 'vid-almuerzos-margoth',
    titulo: 'Promo Almuerzos Típicos y Pupusas Calientes',
    duracionSegundos: 15,
    horario: '11:00 - 15:30',
    previewUrl: '/api/media/stream/vid-almuerzos-margoth',
  },
  {
    id: 'vid-desayunos-tipicos',
    titulo: 'Desayunos Salvadoreños · Plátanos, Casamiento y Crema',
    duracionSegundos: 15,
    horario: '06:30 - 11:00',
    previewUrl: '/api/media/stream/vid-desayunos-tipicos',
  },
  {
    id: 'vid-tarde-cafe-antojitos',
    titulo: 'Tardes de Antojitos · Empanadas, Nuégados y Café de Palo',
    duracionSegundos: 15,
    horario: '15:30 - 21:30',
    previewUrl: '/api/media/stream/vid-tarde-cafe-antojitos',
  },
];

const sesionesPairing = new Map<string, SesionPairing>();
const pantallasVinculadas = new Map<string, DispositivoTV>();

function loadPersistedState() {
  try {
    if (fs.existsSync(STATE_FILE_PATH)) {
      const raw = fs.readFileSync(STATE_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.sesiones)) {
        for (const s of parsed.sesiones) {
          if (s?.codigoSeisDigitos) sesionesPairing.set(String(s.codigoSeisDigitos), s);
        }
      }
      if (Array.isArray(parsed.pantallas)) {
        for (const p of parsed.pantallas) {
          if (p?.id) pantallasVinculadas.set(String(p.id), p);
        }
      }
    }
  } catch (e) {
    console.error('Error loading persisted state:', e);
  }
}

function savePersistedState() {
  try {
    const payload = {
      sesiones: Array.from(sesionesPairing.values()),
      pantallas: Array.from(pantallasVinculadas.values()),
    };
    fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving persisted state:', e);
  }
}

loadPersistedState();

async function forwardToProductionVps(
  endpointPath: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: unknown,
  customBaseUrl?: string
): Promise<{ ok: boolean; status: number; data: any } | null> {
  const origin = normalizeToApiOrigin(customBaseUrl);
  const url = `${origin}${endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 13; Chromecast HD) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      body: method !== 'GET' && body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await response.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    return {
      ok: response.ok,
      status: response.status,
      data,
    };
  } catch (err) {
    console.error(`Error forwarding ${method} ${url}:`, err);
    return null;
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, X-Base-Url');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json());

  // 1. Solicitar código de vinculación de 6 dígitos -> Conecta directo a https://panel.aryessv.com/api/pairing/request-code
  app.post('/api/pairing/request-code', async (req, res) => {
    const customBase = (req.headers['x-base-url'] as string) || req.body?.baseUrl;
    const modeloHardware = req.body?.modeloHardware || 'Android TV - Típicos Margoth Kiosk';

    const remote = await forwardToProductionVps(
      '/api/pairing/request-code',
      'POST',
      { modeloHardware },
      customBase
    );

    if (remote && remote.status >= 200 && remote.status < 300 && remote.data?.sesionTV) {
      sesionesPairing.set(remote.data.sesionTV.codigoSeisDigitos, remote.data.sesionTV);
      savePersistedState();
      res.status(remote.status).json(remote.data);
      return;
    }

    // Fallback local solo si el servidor remoto no respondiera
    const codigoSeisDigitos = Math.floor(100000 + Math.random() * 900000).toString();
    const ahora = Date.now();
    const nuevaSesion: SesionPairing = {
      codigoSeisDigitos,
      estado: 'ESPERANDO_VINCULACION',
      modeloHardware,
      resolucionDetectada: '1920x1080',
      creadoEn: ahora,
      expiraEn: ahora + 30 * 60 * 1000,
    };
    sesionesPairing.set(codigoSeisDigitos, nuevaSesion);
    savePersistedState();
    res.json({ ok: true, sesionTV: nuevaSesion });
  });

  // 2. Consultar estado del código cada 2.5s -> Conecta directo a https://panel.aryessv.com/api/pairing/status/:codigoSeisDigitos
  app.get('/api/pairing/status/:codigoSeisDigitos', async (req, res) => {
    const rawCode = String(req.params.codigoSeisDigitos || '').replace(/\D/g, '').slice(0, 6);
    const customBase = req.headers['x-base-url'] as string;

    // Si fue vinculado localmente en el simulador, devolver de inmediato
    const localSession = sesionesPairing.get(rawCode);
    if (localSession && localSession.estado === 'VINCULADA') {
      res.json({ ok: true, sesionTV: localSession });
      return;
    }

    const remote = await forwardToProductionVps(
      `/api/pairing/status/${rawCode}`,
      'GET',
      undefined,
      customBase
    );

    if (remote) {
      if (remote.status === 200 && remote.data?.sesionTV) {
        sesionesPairing.set(rawCode, remote.data.sesionTV);
        savePersistedState();
      }
      res.status(remote.status).json(remote.data);
      return;
    }

    if (localSession) {
      res.json({ ok: true, sesionTV: localSession });
      return;
    }

    res.status(404).json({ ok: false, error: 'CODIGO_NO_ENCONTRADO' });
  });

  // 3. Sincronización horaria y latido cada 30s -> Conecta directo a https://panel.aryessv.com/api/tv-player/sync/:pantallaId
  app.get('/api/tv-player/sync/:pantallaId', async (req, res) => {
    const { pantallaId } = req.params;
    const customBase = req.headers['x-base-url'] as string;
    const origin = normalizeToApiOrigin(customBase);

    const remote = await forwardToProductionVps(
      `/api/tv-player/sync/${pantallaId}`,
      'GET',
      undefined,
      customBase
    );

    if (remote) {
      if (remote.status === 200 && remote.data) {
        // Asegurar que las previewUrl relativas apunten al servidor real https://panel.aryessv.com
        const data = { ...remote.data };
        if (data.videoAsignado && typeof data.videoAsignado.previewUrl === 'string') {
          if (data.videoAsignado.previewUrl.startsWith('/')) {
            data.videoAsignado.previewUrl = `${origin}${data.videoAsignado.previewUrl}`;
          }
        }
        if (Array.isArray(data.playlistVideos)) {
          data.playlistVideos = data.playlistVideos.map((v: any) => ({
            ...v,
            previewUrl:
              typeof v?.previewUrl === 'string' && v.previewUrl.startsWith('/')
                ? `${origin}${v.previewUrl}`
                : v?.previewUrl,
          }));
        }
        res.status(200).json(data);
        return;
      }

      // Si panel.aryessv.com devuelve 404 pero fue una pantalla de prueba local
      const localScreen = pantallasVinculadas.get(pantallaId);
      if (remote.status === 404 && localScreen) {
        res.json({
          ok: true,
          horaElSalvador: '14:30',
          diaElSalvador: 'miercoles',
          pantalla: {
            id: localScreen.id,
            nombre: localScreen.nombre,
            sucursal: localScreen.sucursal,
            orientacion: localScreen.orientacion,
          },
          videoAsignado: CATALOGO_VIDEOS[0],
          playlistVideos: CATALOGO_VIDEOS,
        });
        return;
      }

      res.status(remote.status).json(remote.data);
      return;
    }

    res.status(503).json({ ok: false, error: 'SERVIDOR_NO_DISPONIBLE' });
  });

  // 4. Desconexión limpia -> Conecta directo a https://panel.aryessv.com/api/tv-player/disconnect/:pantallaId
  app.post('/api/tv-player/disconnect/:pantallaId', async (req, res) => {
    const { pantallaId } = req.params;
    const customBase = req.headers['x-base-url'] as string;

    const remote = await forwardToProductionVps(
      `/api/tv-player/disconnect/${pantallaId}`,
      'POST',
      {},
      customBase
    );

    if (remote) {
      res.status(remote.status).json(remote.data);
      return;
    }

    res.json({ ok: true, disconnectedAt: Date.now(), pantallaId });
  });

  // Proxy general hacia https://panel.aryessv.com (normalizando cualquier URL como https//:panel.aryessv.com/tv)
  app.post('/api/remote-proxy', async (req, res) => {
    const { targetUrl, endpointPath, method = 'GET', body } = req.body || {};
    let finalPath = endpointPath || '';
    let baseOrigin = PRODUCTION_VPS_ORIGIN;

    if (targetUrl && typeof targetUrl === 'string') {
      const apiIdx = targetUrl.indexOf('/api/');
      if (apiIdx !== -1) {
        baseOrigin = normalizeToApiOrigin(targetUrl.slice(0, apiIdx));
        finalPath = targetUrl.slice(apiIdx);
      } else {
        baseOrigin = normalizeToApiOrigin(targetUrl);
      }
    }

    const remote = await forwardToProductionVps(
      finalPath || '/api/pairing/request-code',
      method,
      body,
      baseOrigin
    );

    if (remote) {
      res.status(remote.status).json({
        ok: remote.ok,
        status: remote.status,
        data: remote.data,
      });
      return;
    }

    res.status(502).json({
      ok: false,
      error: `No se pudo conectar con ${baseOrigin}`,
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `Típicos Margoth · Reproductor TV conectado a ${PRODUCTION_VPS_ORIGIN} en puerto ${PORT}`
    );
  });
}

startServer();
