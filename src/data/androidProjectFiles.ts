export interface AndroidSourceFile {
  path: string;
  filename: string;
  language: 'kotlin' | 'xml' | 'gradle' | 'properties' | 'markdown';
  description: string;
  content: string;
}

export const ANDROID_TV_CONSTANTS = {
  DEFAULT_BASE_URL: 'https://panel.aryessv.com/tv',
  API_ORIGIN_URL: 'https://panel.aryessv.com',
  STANDBY_IMAGE_URL: 'https://pub-29979a9319a64459816c0aa2b9d4d11c.r2.dev/fondo.webp',
  PREFS_NAME: 'margoth_prefs',
  PREF_KEY_TV_ID: 'margoth_tv_id',
  PREF_KEY_BASE_URL: 'margoth_base_url',
  PAIRING_POLL_MS: 2500,
  SYNC_HEARTBEAT_MS: 30000,
  MODAL_AUTO_CLOSE_SEC: 15,
};

export const ANDROID_PROJECT_FILES: AndroidSourceFile[] = [
  {
    path: 'app/src/main/AndroidManifest.xml',
    filename: 'AndroidManifest.xml',
    language: 'xml',
    description: 'Manifiesto con permisos de energía 24/7, categorías LAUNCHER + LEANBACK_LAUNCHER + HOME (Kiosco), BootReceiver y KeepAliveService.',
    content: `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools"
    package="com.tipicosmargoth.tvplayer">

    <!-- Permisos de Red y Estado Wi-Fi -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />

    <!-- Permisos Estrictos de Energía, Auto-Arranque y Cero Suspensión 24/7 -->
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
    <uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
    <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />

    <!-- Compatibilidad con Android TV / Google TV sin requerir pantalla táctil -->
    <uses-feature
        android:name="android.software.leanback"
        android:required="false" />
    <uses-feature
        android:name="android.hardware.touchscreen"
        android:required="false" />

    <application
        android:allowBackup="true"
        android:banner="@drawable/tv_banner"
        android:directBootAware="true"
        android:hardwareAccelerated="true"
        android:icon="@mipmap/ic_launcher"
        android:label="Típicos Margoth · Reproductor TV"
        android:largeHeap="true"
        android:supportsRtl="true"
        android:theme="@style/Theme.AppCompat.NoActionBar"
        android:usesCleartextTraffic="true"
        tools:targetApi="34">

        <!-- Actividad Principal Kiosco 24/7 -->
        <activity
            android:name=".MainActivity"
            android:configChanges="keyboard|keyboardHidden|navigation|orientation|screenSize|screenLayout|smallestScreenSize|uiMode"
            android:directBootAware="true"
            android:exported="true"
            android:keepScreenOn="true"
            android:launchMode="singleTask"
            android:screenOrientation="unspecified"
            android:showWhenLocked="true"
            android:turnScreenOn="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />

                <category android:name="android.intent.category.LAUNCHER" />
                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />
                <category android:name="android.intent.category.HOME" />
                <category android:name="android.intent.category.DEFAULT" />
            </intent-filter>
        </activity>

        <!-- Receptor de Auto-Arranque al encender el Televisor o actualizar APK -->
        <receiver
            android:name=".BootReceiver"
            android:directBootAware="true"
            android:enabled="true"
            android:exported="true"
            android:permission="android.permission.RECEIVE_BOOT_COMPLETED">
            <intent-filter android:priority="999">
                <action android:name="android.intent.action.BOOT_COMPLETED" />
                <action android:name="android.intent.action.QUICKBOOT_POWERON" />
                <action android:name="com.htc.intent.action.QUICKBOOT_POWERON" />
                <action android:name="android.intent.action.LOCKED_BOOT_COMPLETED" />
                <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
                <category android:name="android.intent.category.DEFAULT" />
            </intent-filter>
        </receiver>

        <!-- Servicio Persistente KeepAlive con WakeLock + WifiLock -->
        <service
            android:name=".KeepAliveService"
            android:directBootAware="true"
            android:enabled="true"
            android:exported="false"
            android:foregroundServiceType="mediaPlayback" />

    </application>

</manifest>`,
  },
  {
    path: 'app/src/main/java/com/tipicosmargoth/tvplayer/MainActivity.kt',
    filename: 'MainActivity.kt',
    language: 'kotlin',
    description: 'Actividad principal Kiosco 24/7: bloqueo total de protector de pantalla, máquina de estados (Vinculación 6 dígitos vs Sincronización 30s), caché de video ExoPlayer y Modal D-Pad con F5 y auto-cierre 15s.',
    content: `package com.tipicosmargoth.tvplayer

import android.annotation.SuppressLint
import android.app.Dialog
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.CountDownTimer
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

@UnstableApi
class MainActivity : AppCompatActivity() {

    companion object {
        const val DEFAULT_BASE_URL = "https://panel.aryessv.com"
        const val STANDBY_BG_URL = "https://pub-29979a9319a64459816c0aa2b9d4d11c.r2.dev/fondo.webp"
        const val PREFS_NAME = "margoth_prefs"
        const val KEY_TV_ID = "margoth_tv_id"
        const val KEY_BASE_URL = "margoth_base_url"

        private const val PAIRING_POLL_INTERVAL_MS = 2_500L
        private const val SYNC_INTERVAL_MS = 30_000L
        private const val MODAL_TIMEOUT_MS = 15_000L
    }

    private lateinit var prefs: SharedPreferences
    private val mainScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var pairingJob: Job? = null
    private var syncJob: Job? = null

    // Vistas principales del Kiosco
    private lateinit var rootContainer: FrameLayout
    private lateinit var playerView: PlayerView
    private lateinit var standbyImageView: ImageView
    private lateinit var pairingContainer: LinearLayout
    private lateinit var codeBoxTextView: TextView
    private lateinit var pairingStatusTextView: TextView

    // Reproductor ExoPlayer Media3
    private var exoPlayer: ExoPlayer? = null
    private var currentPlaylistSignature: String = ""
    private var currentOrientation: String = "HORIZONTAL_16_9"

    // Modal de Control Remoto (Salir Sí/No + Refrescar F5)
    private var controlDialog: Dialog? = null
    private var modalAutoCloseTimer: CountDownTimer? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 1. Reglas estrictas de energía y bloqueo de protector de pantalla
        enforceWakeAndLockScreenFlags()
        hideSystemBarsImmersive()

        prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

        // 2. Iniciar servicio persistente KeepAliveService (WakeLock + WifiLock)
        startKeepAliveService()

        // 3. Solicitar exención de optimización de batería (Doze Mode)
        requestIgnoreBatteryOptimizationsIfNeeded()

        // 4. Construir interfaz nativa optimizada para TV
        setupUserInterface()

        // 5. Interceptar botón Atrás (BACK) para abrir siempre el menú de control
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                showRemoteControlModal()
            }
        })

        // 6. Precargar en caché local la imagen corporativa de espera (fondo.webp)
        preloadCorporateStandbyImage()

        // 7. Iniciar flujo según estado de vinculación
        evaluateStateAndStart()
    }

    override fun onResume() {
        super.onResume()
        enforceWakeAndLockScreenFlags()
        hideSystemBarsImmersive()
        rootContainer.keepScreenOn = true
        playerView.keepScreenOn = true
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            hideSystemBarsImmersive()
        }
    }

    /**
     * Bloqueo total de suspensión y protector de pantalla (Ambient Mode / Daydream)
     */
    private fun enforceWakeAndLockScreenFlags() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }
        @Suppress("DEPRECATION")
        window.addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
        )
    }

    private fun hideSystemBarsImmersive() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    private fun startKeepAliveService() {
        try {
            val serviceIntent = Intent(this, KeepAliveService::class.java)
            ContextCompat.startForegroundService(this, serviceIntent)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    @SuppressLint("BatteryLife")
    private fun requestIgnoreBatteryOptimizationsIfNeeded() {
        try {
            val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
            if (!powerManager.isIgnoringBatteryOptimizations(packageName)) {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:$packageName")
                }
                startActivity(intent)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun getBaseUrl(): String {
        return prefs.getString(KEY_BASE_URL, DEFAULT_BASE_URL)
            ?.trim()
            ?.trimEnd('/')
            ?.takeIf { it.isNotEmpty() }
            ?: DEFAULT_BASE_URL
    }

    private fun getPantallaId(): String? {
        return prefs.getString(KEY_TV_ID, null)?.takeIf { it.isNotBlank() }
    }

    private fun setupUserInterface() {
        rootContainer = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.parseColor("#0A0F1D"))
            keepScreenOn = true
        }

        // Imagen corporativa de espera cuando no hay video programado en horario
        standbyImageView = ImageView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            scaleType = ImageView.ScaleType.CENTER_CROP
            visibility = View.GONE
            keepScreenOn = true
        }

        // PlayerView de ExoPlayer sin controles en pantalla (Kiosco limpio)
        playerView = PlayerView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
                Gravity.CENTER
            )
            useController = false
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            setShutterBackgroundColor(Color.parseColor("#0A0F1D"))
            keepScreenOn = true
            visibility = View.GONE
        }

        // Vista Estado 1: Pantalla No Vinculada (#0A0F1D)
        pairingContainer = LinearLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#0A0F1D"))
            setPadding(dp(48), dp(48), dp(48), dp(48))
            keepScreenOn = true
        }

        val subtitleTop = TextView(this).apply {
            text = "TÍPICOS MARGOTH · ENLACE DE PANTALLA"
            setTextColor(Color.parseColor("#F59E0B"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            letterSpacing = 0.14f
            gravity = Gravity.CENTER
        }

        codeBoxTextView = TextView(this).apply {
            text = "------"
            setTextColor(Color.parseColor("#F8FAFC"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 72f)
            typeface = Typeface.MONOSPACE
            letterSpacing = 0.18f
            gravity = Gravity.CENTER
            setPadding(dp(56), dp(28), dp(56), dp(28))
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = dp(16).toFloat()
                setColor(Color.parseColor("#020617"))
                setStroke(dp(2), Color.parseColor("#334155"))
            }
            val params = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            params.topMargin = dp(28)
            params.bottomMargin = dp(28)
            layoutParams = params
        }

        val instructionBottom = TextView(this).apply {
            text = "Ingresa este código de 6 dígitos en la sección Pantallas → Vincular TV de tu panel administrativo."
            setTextColor(Color.parseColor("#CBD5E1"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            gravity = Gravity.CENTER
            maxWidth = dp(760)
        }

        pairingStatusTextView = TextView(this).apply {
            text = "Conectando con servidor..."
            setTextColor(Color.parseColor("#64748B"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            gravity = Gravity.CENTER
            val params = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            params.topMargin = dp(20)
            layoutParams = params
        }

        pairingContainer.addView(subtitleTop)
        pairingContainer.addView(codeBoxTextView)
        pairingContainer.addView(instructionBottom)
        pairingContainer.addView(pairingStatusTextView)

        rootContainer.addView(standbyImageView)
        rootContainer.addView(playerView)
        rootContainer.addView(pairingContainer)

        setContentView(rootContainer)
    }

    /**
     * Descarga y guarda en caché local la imagen corporativa de espera (fondo.webp)
     */
    private fun preloadCorporateStandbyImage() {
        mainScope.launch(Dispatchers.IO) {
            val cacheDir = File(filesDir, "cache").apply { mkdirs() }
            val localFile = File(cacheDir, "fondo.webp")

            if (!localFile.exists() || localFile.length() == 0L) {
                try {
                    val connection = (URL(STANDBY_BG_URL).openConnection() as HttpURLConnection).apply {
                        connectTimeout = 10_000
                        readTimeout = 15_000
                    }
                    if (connection.responseCode == HttpURLConnection.HTTP_OK) {
                        connection.inputStream.use { input ->
                            localFile.outputStream().use { output ->
                                input.copyTo(output)
                            }
                        }
                    }
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }

            if (localFile.exists() && localFile.length() > 0L) {
                val bitmap = BitmapFactory.decodeFile(localFile.absolutePath)
                if (bitmap != null) {
                    withContext(Dispatchers.Main) {
                        standbyImageView.setImageBitmap(bitmap)
                    }
                }
            }
        }
    }

    /**
     * Evalúa si existe "margoth_tv_id" en SharedPreferences
     */
    private fun evaluateStateAndStart() {
        pairingJob?.cancel()
        syncJob?.cancel()

        val pantallaId = getPantallaId()
        if (pantallaId.isNullOrEmpty()) {
            enterUnpairedState()
        } else {
            enterPairedSyncState(pantallaId)
        }
    }

    /**
     * ESTADO 1: Pantalla No Vinculada ("margoth_tv_id" es null o vacío)
     */
    private fun enterUnpairedState() {
        releaseExoPlayer()
        playerView.visibility = View.GONE
        standbyImageView.visibility = View.GONE
        pairingContainer.visibility = View.VISIBLE
        codeBoxTextView.text = "------"
        pairingStatusTextView.text = "Solicitando código de enlace a \${getBaseUrl()}..."

        pairingJob = mainScope.launch {
            while (isActive && getPantallaId().isNullOrEmpty()) {
                val hardwareModel = "Android TV - \${Build.MANUFACTURER} \${Build.MODEL}"
                val requestResult = withContext(Dispatchers.IO) {
                    ApiClient.requestPairingCode(getBaseUrl(), hardwareModel)
                }

                if (requestResult != null && requestResult.codigoSeisDigitos.isNotBlank()) {
                    val code = requestResult.codigoSeisDigitos
                    codeBoxTextView.text = code
                    pairingStatusTextView.text = "Esperando vinculación en el panel administrativo (cada 2.5s)..."

                    // Consultar GET {BASE_URL}/api/pairing/status/{codigoSeisDigitos} cada 2.5 segundos
                    var codeValid = true
                    while (isActive && codeValid) {
                        delay(PAIRING_POLL_INTERVAL_MS)
                        val statusResult = withContext(Dispatchers.IO) {
                            ApiClient.checkPairingStatus(getBaseUrl(), code)
                        }

                        if (statusResult == null) {
                            continue
                        }

                        if (statusResult.httpCode == 404) {
                            // Código expirado, pedir uno nuevo
                            codeValid = false
                        } else if (
                            statusResult.estado == "VINCULADA" &&
                            !statusResult.dispositivoVinculadoId.isNullOrBlank()
                        ) {
                            val newId = statusResult.dispositivoVinculadoId
                            prefs.edit().putString(KEY_TV_ID, newId).apply()
                            pairingContainer.visibility = View.GONE
                            enterPairedSyncState(newId)
                            return@launch
                        }
                    }
                } else {
                    pairingStatusTextView.text = "Reintentando conexión con \${getBaseUrl()}..."
                    delay(5_000L)
                }
            }
        }
    }

    /**
     * ESTADO 2: Pantalla Vinculada (Sincronización Horaria y Latido cada 30s)
     */
    private fun enterPairedSyncState(pantallaId: String) {
        pairingContainer.visibility = View.GONE
        initializeExoPlayerIfNeeded()

        syncJob = mainScope.launch {
            while (isActive) {
                performSyncCycle(pantallaId, forceReload = false)
                delay(SYNC_INTERVAL_MS)
            }
        }
    }

    private suspend fun performSyncCycle(pantallaId: String, forceReload: Boolean) {
        val baseUrl = getBaseUrl()
        val syncResponse = withContext(Dispatchers.IO) {
            ApiClient.syncTvPlayer(baseUrl, pantallaId)
        } ?: return

        // Si responde HTTP 404 (PANTALLA_NO_ENCONTRADA): borrar margoth_tv_id y volver al Estado 1
        if (syncResponse.httpCode == 404) {
            prefs.edit().remove(KEY_TV_ID).apply()
            currentPlaylistSignature = ""
            enterUnpairedState()
            return
        }

        if (!syncResponse.ok) return

        // Aplicar orientación de la pantalla si fue configurada
        applyScreenOrientation(syncResponse.orientacion)

        // Determinar lista de videos a reproducir
        val rawUrls = mutableListOf<String>()
        if (syncResponse.playlistVideos.isNotEmpty()) {
            syncResponse.playlistVideos.forEach { item ->
                if (item.previewUrl.isNotBlank()) {
                    rawUrls.add(resolveMediaUrl(baseUrl, item.previewUrl))
                }
            }
        } else if (syncResponse.videoAsignado != null && syncResponse.videoAsignado.previewUrl.isNotBlank()) {
            rawUrls.add(resolveMediaUrl(baseUrl, syncResponse.videoAsignado.previewUrl))
        }

        // Si no hay videos asignados en el horario actual, mostrar fondo.webp manteniendo keepScreenOn = true
        if (rawUrls.isEmpty()) {
            exoPlayer?.stop()
            currentPlaylistSignature = "STANDBY_EMPTY"
            playerView.visibility = View.GONE
            standbyImageView.visibility = View.VISIBLE
            standbyImageView.keepScreenOn = true
            rootContainer.keepScreenOn = true
            return
        }

        val newSignature = rawUrls.joinToString("|")
        if (forceReload || newSignature != currentPlaylistSignature || exoPlayer?.isPlaying == false) {
            currentPlaylistSignature = newSignature
            standbyImageView.visibility = View.GONE
            playerView.visibility = View.VISIBLE
            playerView.keepScreenOn = true
            rootContainer.keepScreenOn = true

            initializeExoPlayerIfNeeded()
            exoPlayer?.let { player ->
                player.stop()
                player.clearMediaItems()
                val mediaItems = rawUrls.map { url -> MediaItem.fromUri(Uri.parse(url)) }
                player.setMediaItems(mediaItems)
                player.repeatMode = Player.REPEAT_MODE_ALL
                player.prepare()
                player.playWhenReady = true
            }
        }
    }

    private fun resolveMediaUrl(baseUrl: String, previewUrl: String): String {
        return if (previewUrl.startsWith("http://") || previewUrl.startsWith("https://")) {
            previewUrl
        } else {
            val cleanBase = baseUrl.trimEnd('/')
            val cleanPath = if (previewUrl.startsWith("/")) previewUrl else "/$previewUrl"
            "$cleanBase$cleanPath"
        }
    }

    private fun applyScreenOrientation(orientacion: String) {
        if (orientacion == currentOrientation) return
        currentOrientation = orientacion
        playerView.rotation = if (orientacion == "VERTICAL_9_16") 90f else 0f
    }

    private fun initializeExoPlayerIfNeeded() {
        if (exoPlayer != null) return

        val httpDataSourceFactory = DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(20_000)

        val cacheDataSourceFactory = CacheDataSource.Factory()
            .setCache(VideoCacheSingleton.getInstance(this))
            .setUpstreamDataSourceFactory(httpDataSourceFactory)
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)

        exoPlayer = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(cacheDataSourceFactory))
            .build()
            .apply {
                setWakeMode(C.WAKE_MODE_NETWORK)
                repeatMode = Player.REPEAT_MODE_ALL
                playWhenReady = true
                addListener(object : Player.Listener {
                    override fun onPlayerError(error: PlaybackException) {
                        // Auto-recuperación ante micro-cortes de red o decodificación
                        Handler(Looper.getMainLooper()).postDelayed({
                            exoPlayer?.prepare()
                            exoPlayer?.playWhenReady = true
                        }, 3_000L)
                    }
                })
            }

        playerView.player = exoPlayer
        playerView.keepScreenOn = true
    }

    private fun releaseExoPlayer() {
        try {
            playerView.player = null
            exoPlayer?.stop()
            exoPlayer?.clearMediaItems()
            exoPlayer?.release()
        } catch (e: Exception) {
            e.printStackTrace()
        } finally {
            exoPlayer = null
        }
    }

    /**
     * Acción "🔄 Refrescar Pantalla (F5)" desde el control remoto
     */
    private fun performHardRefreshF5() {
        Toast.makeText(
            this,
            "Sincronizando y refrescando pantalla...",
            Toast.LENGTH_SHORT
        ).show()

        // 1. Reiniciar limpiamente la instancia de ExoPlayer (liberando caché de RAM del decodificador)
        releaseExoPlayer()
        currentPlaylistSignature = ""

        // 2. Consultar inmediatamente el estado de sincronización o vinculación y recargar desde cero
        val pantallaId = getPantallaId()
        if (pantallaId.isNullOrEmpty()) {
            evaluateStateAndStart()
        } else {
            initializeExoPlayerIfNeeded()
            mainScope.launch {
                performSyncCycle(pantallaId, forceReload = true)
            }
        }
    }

    /**
     * Acción "Sí, salir de la aplicación" desde el control remoto
     */
    private fun performGracefulDisconnectAndExit() {
        val pantallaId = getPantallaId()
        val baseUrl = getBaseUrl()

        mainScope.launch {
            if (!pantallaId.isNullOrEmpty()) {
                withContext(Dispatchers.IO) {
                    ApiClient.disconnectTvPlayer(baseUrl, pantallaId)
                }
            }
            pairingJob?.cancel()
            syncJob?.cancel()
            releaseExoPlayer()
            stopService(Intent(this@MainActivity, KeepAliveService::class.java))
            finishAffinity()
        }
    }

    /**
     * Interceptar teclas del control remoto de Android TV (BACK, DPAD_CENTER, ENTER, MENU)
     */
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        when (keyCode) {
            KeyEvent.KEYCODE_BACK,
            KeyEvent.KEYCODE_DPAD_CENTER,
            KeyEvent.KEYCODE_ENTER,
            KeyEvent.KEYCODE_NUMPAD_ENTER,
            KeyEvent.KEYCODE_MENU -> {
                if (controlDialog?.isShowing != true) {
                    showRemoteControlModal()
                    return true
                }
            }
        }
        return super.onKeyDown(keyCode, event)
    }

    /**
     * Menú de Control con el Control Remoto (Salir Sí/No + Botón Refrescar "F5" + Auto-Cierre 15s)
     */
    private fun showRemoteControlModal() {
        if (controlDialog?.isShowing == true) return

        val dialog = Dialog(this)
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)
        dialog.window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        dialog.setCancelable(true)

        val modalCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(32), dp(28), dp(32), dp(28))
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = dp(18).toFloat()
                setColor(Color.parseColor("#0F172A"))
                setStroke(dp(2), Color.parseColor("#334155"))
            }
        }

        val titleView = TextView(this).apply {
            text = "Opciones de Pantalla · Típicos Margoth"
            setTextColor(Color.parseColor("#F8FAFC"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        }

        val questionView = TextView(this).apply {
            text = "¿Deseas refrescar el contenido o salir de la aplicación?"
            setTextColor(Color.parseColor("#CBD5E1"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            val params = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            params.topMargin = dp(8)
            params.bottomMargin = dp(20)
            layoutParams = params
        }

        val countdownTextView = TextView(this).apply {
            text = "Cierre automático de seguridad en 15s"
            setTextColor(Color.parseColor("#94A3B8"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            gravity = Gravity.END
            val params = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            params.topMargin = dp(14)
            layoutParams = params
        }

        // Botón 1 (Foco inicial por defecto): "🔄 Refrescar Pantalla (F5)"
        val btnRefreshF5 = createDpadButton(
            label = "🔄 Refrescar Pantalla (F5)",
            normalBg = "#1E293B",
            focusedBg = "#2563EB",
            focusedBorder = "#93C5FD"
        ) {
            dismissRemoteControlModal()
            performHardRefreshF5()
        }

        // Botón 2: "No, continuar reproduciendo"
        val btnContinue = createDpadButton(
            label = "No, continuar reproduciendo",
            normalBg = "#1E293B",
            focusedBg = "#334155",
            focusedBorder = "#F8FAFC"
        ) {
            dismissRemoteControlModal()
        }

        // Botón 3 (Color rojo de advertencia): "Sí, salir de la aplicación"
        val btnExit = createDpadButton(
            label = "Sí, salir de la aplicación",
            normalBg = "#450A0A",
            focusedBg = "#DC2626",
            focusedBorder = "#FCA5A5"
        ) {
            dismissRemoteControlModal()
            performGracefulDisconnectAndExit()
        }

        // Opción adicional para cambiar BASE_URL si fuera necesario desde el menú de control
        val btnChangeServer = createDpadButton(
            label = "Cambiar Servidor Base (\${getBaseUrl()})",
            normalBg = "#0F172A",
            focusedBg = "#1E293B",
            focusedBorder = "#F59E0B"
        ) {
            dismissRemoteControlModal()
            showChangeBaseUrlDialog()
        }

        modalCard.addView(titleView)
        modalCard.addView(questionView)
        modalCard.addView(btnRefreshF5)
        modalCard.addView(btnContinue)
        modalCard.addView(btnExit)
        modalCard.addView(btnChangeServer)
        modalCard.addView(countdownTextView)

        dialog.setContentView(
            modalCard,
            ViewGroup.LayoutParams(dp(540), ViewGroup.LayoutParams.WRAP_CONTENT)
        )

        dialog.setOnKeyListener { _, _, event ->
            if (event.action == KeyEvent.ACTION_DOWN) {
                restartModalAutoCloseTimer(countdownTextView)
            }
            false
        }

        dialog.setOnDismissListener {
            modalAutoCloseTimer?.cancel()
            hideSystemBarsImmersive()
        }

        controlDialog = dialog
        dialog.show()

        // Foco inicial por defecto en Botón 1 ("🔄 Refrescar Pantalla (F5)")
        btnRefreshF5.requestFocus()
        restartModalAutoCloseTimer(countdownTextView)
    }

    private fun createDpadButton(
        label: String,
        normalBg: String,
        focusedBg: String,
        focusedBorder: String,
        onClick: () -> Unit
    ): Button {
        return Button(this).apply {
            text = label
            isAllCaps = false
            setTextColor(Color.parseColor("#F8FAFC"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            gravity = Gravity.CENTER_VERTICAL or Gravity.START
            setPadding(dp(20), dp(14), dp(20), dp(14))
            isFocusable = true
            isFocusableInTouchMode = true

            val params = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            params.bottomMargin = dp(10)
            layoutParams = params

            fun applyStyle(hasFocus: Boolean) {
                background = GradientDrawable().apply {
                    shape = GradientDrawable.RECTANGLE
                    cornerRadius = dp(10).toFloat()
                    setColor(Color.parseColor(if (hasFocus) focusedBg else normalBg))
                    setStroke(
                        dp(if (hasFocus) 3 else 1),
                        Color.parseColor(if (hasFocus) focusedBorder else "#334155")
                    )
                }
            }

            applyStyle(false)
            setOnFocusChangeListener { _, hasFocus -> applyStyle(hasFocus) }
            setOnClickListener { onClick() }
        }
    }

    private fun restartModalAutoCloseTimer(countdownLabel: TextView) {
        modalAutoCloseTimer?.cancel()
        modalAutoCloseTimer = object : CountDownTimer(MODAL_TIMEOUT_MS, 1_000L) {
            override fun onTick(millisUntilFinished: Long) {
                val seconds = (millisUntilFinished / 1000L) + 1
                countdownLabel.text = "Cierre automático de seguridad en \${seconds}s"
            }

            override fun onFinish() {
                dismissRemoteControlModal()
            }
        }.start()
    }

    private fun dismissRemoteControlModal() {
        modalAutoCloseTimer?.cancel()
        controlDialog?.dismiss()
        controlDialog = null
    }

    private fun showChangeBaseUrlDialog() {
        val dialog = Dialog(this)
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)
        dialog.window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(28), dp(24), dp(28), dp(24))
            background = GradientDrawable().apply {
                cornerRadius = dp(16).toFloat()
                setColor(Color.parseColor("#0F172A"))
                setStroke(dp(2), Color.parseColor("#334155"))
            }
        }

        val title = TextView(this).apply {
            text = "Configurar BASE_URL del Servidor"
            setTextColor(Color.parseColor("#F8FAFC"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            typeface = Typeface.DEFAULT_BOLD
        }

        val input = EditText(this).apply {
            setText(getBaseUrl())
            setTextColor(Color.parseColor("#F8FAFC"))
            setHintTextColor(Color.parseColor("#64748B"))
            hint = DEFAULT_BASE_URL
            setSingleLine(true)
        }

        val btnSave = createDpadButton(
            label = "Guardar y Reiniciar Sincronización",
            normalBg = "#1E293B",
            focusedBg = "#2563EB",
            focusedBorder = "#93C5FD"
        ) {
            val updated = input.text.toString().trim().trimEnd('/').ifEmpty { DEFAULT_BASE_URL }
            prefs.edit().putString(KEY_BASE_URL, updated).apply()
            dialog.dismiss()
            performHardRefreshF5()
        }

        container.addView(title)
        container.addView(input)
        container.addView(btnSave)
        dialog.setContentView(
            container,
            ViewGroup.LayoutParams(dp(480), ViewGroup.LayoutParams.WRAP_CONTENT)
        )
        dialog.show()
    }

    private fun dp(value: Int): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value.toFloat(),
            resources.displayMetrics
        ).toInt()
    }

    override fun onDestroy() {
        modalAutoCloseTimer?.cancel()
        mainScope.cancel()
        releaseExoPlayer()
        super.onDestroy()
    }
}`,
  },
  {
    path: 'app/src/main/java/com/tipicosmargoth/tvplayer/BootReceiver.kt',
    filename: 'BootReceiver.kt',
    language: 'kotlin',
    description: 'BroadcastReceiver de auto-arranque que escucha BOOT_COMPLETED, QUICKBOOT_POWERON, LOCKED_BOOT_COMPLETED y MY_PACKAGE_REPLACED.',
    content: `package com.tipicosmargoth.tvplayer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return

        val validBootActions = setOf(
            Intent.ACTION_BOOT_COMPLETED,
            "android.intent.action.QUICKBOOT_POWERON",
            "com.htc.intent.action.QUICKBOOT_POWERON",
            Intent.ACTION_LOCKED_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED
        )

        if (action in validBootActions) {
            // 1. Iniciar servicio persistente KeepAliveService con WakeLock + WifiLock
            try {
                val serviceIntent = Intent(context, KeepAliveService::class.java)
                ContextCompat.startForegroundService(context, serviceIntent)
            } catch (e: Exception) {
                e.printStackTrace()
            }

            // 2. Lanzar MainActivity automáticamente en modo Kiosco
            try {
                val activityIntent = Intent(context, MainActivity::class.java).apply {
                    addFlags(
                        Intent.FLAG_ACTIVITY_NEW_TASK or
                            Intent.FLAG_ACTIVITY_CLEAR_TOP or
                            Intent.FLAG_ACTIVITY_SINGLE_TOP
                    )
                }
                context.startActivity(activityIntent)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }
}`,
  },
  {
    path: 'app/src/main/java/com/tipicosmargoth/tvplayer/KeepAliveService.kt',
    filename: 'KeepAliveService.kt',
    language: 'kotlin',
    description: 'Servicio Foreground persistente 24/7 que mantiene activo PowerManager.WakeLock (SCREEN_BRIGHT_WAKE_LOCK) y WifiManager.WifiLock (WIFI_MODE_FULL_HIGH_PERF).',
    content: `package com.tipicosmargoth.tvplayer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat

class KeepAliveService : Service() {

    companion object {
        private const val CHANNEL_ID = "margoth_tv_kiosk_channel"
        private const val NOTIFICATION_ID = 2407
    }

    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildForegroundNotification())
        acquireWakeAndWifiLocks()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        acquireWakeAndWifiLocks()
        return START_STICKY
    }

    @Suppress("DEPRECATION")
    private fun acquireWakeAndWifiLocks() {
        try {
            if (wakeLock?.isHeld != true) {
                val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
                wakeLock = powerManager.newWakeLock(
                    PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
                    "TipicosMargothTV::KeepScreenBrightWakeLock"
                ).apply {
                    setReferenceCounted(false)
                    acquire()
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }

        try {
            if (wifiLock?.isHeld != true) {
                val wifiManager = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
                val lockMode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                } else {
                    WifiManager.WIFI_MODE_FULL_HIGH_PERF
                }
                wifiLock = wifiManager.createWifiLock(
                    lockMode,
                    "TipicosMargothTV::HighPerfWifiLock"
                ).apply {
                    setReferenceCounted(false)
                    acquire()
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun releaseLocks() {
        try {
            if (wakeLock?.isHeld == true) {
                wakeLock?.release()
            }
        } catch (_: Exception) {}

        try {
            if (wifiLock?.isHeld == true) {
                wifiLock?.release()
            }
        } catch (_: Exception) {}
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Típicos Margoth · Servicio Kiosco 24/7",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Mantiene activa la pantalla y la sincronización de Típicos Margoth TV."
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    private fun buildForegroundNotification(): Notification {
        val openIntent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Típicos Margoth · Reproductor TV")
            .setContentText("Kiosco Digital Signage 24/7 activo")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    override fun onDestroy() {
        releaseLocks()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}`,
  },
  {
    path: 'app/src/main/java/com/tipicosmargoth/tvplayer/ApiClient.kt',
    filename: 'ApiClient.kt',
    language: 'kotlin',
    description: 'Cliente HTTP nativo para los 4 endpoints del contrato API de server.ts (request-code, status, sync, disconnect).',
    content: `package com.tipicosmargoth.tvplayer

import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

data class PairingCodeResponse(
    val ok: Boolean,
    val codigoSeisDigitos: String,
    val estado: String
)

data class PairingStatusResponse(
    val httpCode: Int,
    val ok: Boolean,
    val estado: String,
    val dispositivoVinculadoId: String?
)

data class VideoPayload(
    val id: String,
    val titulo: String,
    val previewUrl: String
)

data class SyncTvResponse(
    val httpCode: Int,
    val ok: Boolean,
    val horaElSalvador: String,
    val diaElSalvador: String,
    val pantallaId: String,
    val orientacion: String,
    val videoAsignado: VideoPayload?,
    val playlistVideos: List<VideoPayload>
)

object ApiClient {

    /**
     * POST {BASE_URL}/api/pairing/request-code
     * Body: { "modeloHardware": "Android TV - <Build.MANUFACTURER> <Build.MODEL>" }
     */
    fun requestPairingCode(baseUrl: String, modeloHardware: String): PairingCodeResponse? {
        val endpoint = "\${baseUrl.trimEnd('/')}/api/pairing/request-code"
        return try {
            val conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 10_000
                readTimeout = 10_000
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                setRequestProperty("Accept", "application/json")
            }

            val payload = JSONObject().apply {
                put("modeloHardware", modeloHardware)
            }

            OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { writer ->
                writer.write(payload.toString())
                writer.flush()
            }

            if (conn.responseCode in 200..299) {
                val body = readStream(conn)
                val json = JSONObject(body)
                val sesion = json.optJSONObject("sesionTV") ?: return null
                PairingCodeResponse(
                    ok = json.optBoolean("ok", false),
                    codigoSeisDigitos = sesion.optString("codigoSeisDigitos", ""),
                    estado = sesion.optString("estado", "ESPERANDO_VINCULACION")
                )
            } else {
                null
            }
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }

    /**
     * GET {BASE_URL}/api/pairing/status/{codigoSeisDigitos}
     */
    fun checkPairingStatus(baseUrl: String, codigoSeisDigitos: String): PairingStatusResponse? {
        val endpoint = "\${baseUrl.trimEnd('/')}/api/pairing/status/\$codigoSeisDigitos"
        return try {
            val conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 8_000
                readTimeout = 8_000
                setRequestProperty("Accept", "application/json")
            }

            val code = conn.responseCode
            if (code == 404) {
                return PairingStatusResponse(404, false, "EXPIRADO", null)
            }

            if (code in 200..299) {
                val json = JSONObject(readStream(conn))
                val sesion = json.optJSONObject("sesionTV")
                val estado = sesion?.optString("estado", "ESPERANDO_VINCULACION") ?: "ESPERANDO_VINCULACION"
                val dispositivo = sesion?.optJSONObject("dispositivoVinculado")
                val dispId = dispositivo?.optString("id", "")?.takeIf { it.isNotBlank() }

                PairingStatusResponse(
                    httpCode = code,
                    ok = json.optBoolean("ok", true),
                    estado = estado,
                    dispositivoVinculadoId = dispId
                )
            } else {
                null
            }
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }

    /**
     * GET {BASE_URL}/api/tv-player/sync/{pantallaId}
     */
    fun syncTvPlayer(baseUrl: String, pantallaId: String): SyncTvResponse? {
        val endpoint = "\${baseUrl.trimEnd('/')}/api/tv-player/sync/\$pantallaId"
        return try {
            val conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 10_000
                readTimeout = 10_000
                setRequestProperty("Accept", "application/json")
            }

            val code = conn.responseCode
            if (code == 404) {
                return SyncTvResponse(
                    httpCode = 404,
                    ok = false,
                    horaElSalvador = "",
                    diaElSalvador = "",
                    pantallaId = pantallaId,
                    orientacion = "HORIZONTAL_16_9",
                    videoAsignado = null,
                    playlistVideos = emptyList()
                )
            }

            if (code in 200..299) {
                val json = JSONObject(readStream(conn))
                val pantallaObj = json.optJSONObject("pantalla")
                val orientacion = pantallaObj?.optString("orientacion", "HORIZONTAL_16_9") ?: "HORIZONTAL_16_9"

                val videoAsignadoObj = json.optJSONObject("videoAsignado")
                val videoAsignado = if (videoAsignadoObj != null) {
                    VideoPayload(
                        id = videoAsignadoObj.optString("id", ""),
                        titulo = videoAsignadoObj.optString("titulo", ""),
                        previewUrl = videoAsignadoObj.optString("previewUrl", "")
                    )
                } else null

                val playlistList = mutableListOf<VideoPayload>()
                val playlistArr = json.optJSONArray("playlistVideos")
                if (playlistArr != null) {
                    for (i in 0 until playlistArr.length()) {
                        val item = playlistArr.optJSONObject(i) ?: continue
                        playlistList.add(
                            VideoPayload(
                                id = item.optString("id", ""),
                                titulo = item.optString("titulo", ""),
                                previewUrl = item.optString("previewUrl", "")
                            )
                        )
                    }
                }

                SyncTvResponse(
                    httpCode = code,
                    ok = json.optBoolean("ok", true),
                    horaElSalvador = json.optString("horaElSalvador", ""),
                    diaElSalvador = json.optString("diaElSalvador", ""),
                    pantallaId = pantallaObj?.optString("id", pantallaId) ?: pantallaId,
                    orientacion = orientacion,
                    videoAsignado = videoAsignado,
                    playlistVideos = playlistList
                )
            } else {
                null
            }
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }

    /**
     * POST {BASE_URL}/api/tv-player/disconnect/{pantallaId}
     */
    fun disconnectTvPlayer(baseUrl: String, pantallaId: String): Boolean {
        val endpoint = "\${baseUrl.trimEnd('/')}/api/tv-player/disconnect/\$pantallaId"
        return try {
            val conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 5_000
                readTimeout = 5_000
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
            conn.outputStream.use { it.write("{}".toByteArray()) }
            conn.responseCode in 200..299
        } catch (e: Exception) {
            false
        }
    }

    private fun readStream(conn: HttpURLConnection): String {
        val stream = if (conn.responseCode in 200..299) conn.inputStream else conn.errorStream
        BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { reader ->
            val sb = StringBuilder()
            var line: String?
            while (reader.readLine().also { line = it } != null) {
                sb.append(line)
            }
            return sb.toString()
        }
    }
}`,
  },
  {
    path: 'app/src/main/java/com/tipicosmargoth/tvplayer/VideoCacheSingleton.kt',
    filename: 'VideoCacheSingleton.kt',
    language: 'kotlin',
    description: 'Caché en disco de 500 MB (SimpleCache + LeastRecentlyUsedCacheEvictor) para reproducir videos sin consumo repetido de red.',
    content: `package com.tipicosmargoth.tvplayer

import android.content.Context
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import java.io.File

@UnstableApi
object VideoCacheSingleton {
    private const val MAX_CACHE_BYTES: Long = 500L * 1024L * 1024L // 500 MB
    private var simpleCache: SimpleCache? = null

    @Synchronized
    fun getInstance(context: Context): SimpleCache {
        if (simpleCache == null) {
            val cacheFolder = File(context.cacheDir, "margoth_media_cache")
            val evictor = LeastRecentlyUsedCacheEvictor(MAX_CACHE_BYTES)
            val dbProvider = StandaloneDatabaseProvider(context.applicationContext)
            simpleCache = SimpleCache(cacheFolder, evictor, dbProvider)
        }
        return simpleCache!!
    }
}`,
  },
  {
    path: 'app/build.gradle.kts',
    filename: 'app/build.gradle.kts',
    language: 'gradle',
    description: 'Configuración Gradle de Android TV con Media3 ExoPlayer, Leanback y Coroutines.',
    content: `plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.tipicosmargoth.tvplayer"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.tipicosmargoth.tvplayer"
        minSdk = 23
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.leanback:leanback:1.0.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // AndroidX Media3 ExoPlayer + Caché de Disco para Digital Signage 24/7
    val media3Version = "1.4.1"
    implementation("androidx.media3:media3-exoplayer:$media3Version")
    implementation("androidx.media3:media3-ui:$media3Version")
    implementation("androidx.media3:media3-datasource:$media3Version")
    implementation("androidx.media3:media3-database:$media3Version")
}`,
  },
  {
    path: 'README-COMPILACION-APK.md',
    filename: 'README-COMPILACION-APK.md',
    language: 'markdown',
    description: 'Guía paso a paso para compilar el APK e instalarlo en Android TV / Google TV / Fire TV Stick.',
    content: `# Típicos Margoth · Reproductor TV (Android TV Kiosco 24/7)

## 1. Requisitos de Compilación
- **Android Studio Ladybug (2024.2)** o superior con JDK 17.
- Android SDK 34 instalado.

## 2. Compilar el archivo APK de Producción
1. Descomprime el archivo \`TipicosMargoth-AndroidTV-Project.zip\` y ábrelo en Android Studio.
2. En el menú superior selecciona **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
3. También puedes compilar por consola:
   \`\`\`bash
   ./gradlew assembleDebug
   \`\`\`
4. El APK quedará generado en \`app/build/outputs/apk/debug/app-debug.apk\`.

## 3. Instalación en el Televisor (Android TV / Google TV / TV Box)
1. En el televisor ve a **Configuración → Sistema → Información → Compilación del SO de Android TV** y presiona 7 veces para activar **Opciones de Desarrollador**.
2. Activa **Depuración por ADB (Red / USB)** o instala la app **Downloader / Send Files to TV** desde Google Play Store.
3. Si instalas por ADB en red local:
   \`\`\`bash
   adb connect <IP_DEL_TELEVISOR>:5555
   adb install -r app-debug.apk
   # Opcional: otorgar permiso de ignorar optimización de batería directamente por ADB
   adb shell dumpsys deviceidle whitelist +com.tipicosmargoth.tvplayer
   \`\`\``,
  },
];
