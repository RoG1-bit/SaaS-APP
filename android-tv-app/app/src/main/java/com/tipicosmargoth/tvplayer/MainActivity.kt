package com.tipicosmargoth.tvplayer

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

    private lateinit var rootContainer: FrameLayout
    private lateinit var playerView: PlayerView
    private lateinit var standbyImageView: ImageView
    private lateinit var pairingContainer: LinearLayout
    private lateinit var codeBoxTextView: TextView
    private lateinit var pairingStatusTextView: TextView

    private var exoPlayer: ExoPlayer? = null
    private var currentPlaylistSignature: String = ""
    private var currentOrientation: String = "HORIZONTAL_16_9"

    private var controlDialog: Dialog? = null
    private var modalAutoCloseTimer: CountDownTimer? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        enforceWakeAndLockScreenFlags()
        hideSystemBarsImmersive()

        prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

        startKeepAliveService()
        requestIgnoreBatteryOptimizationsIfNeeded()
        setupUserInterface()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                showRemoteControlModal()
            }
        })

        preloadCorporateStandbyImage()
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

        standbyImageView = ImageView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            scaleType = ImageView.ScaleType.CENTER_CROP
            visibility = View.GONE
            keepScreenOn = true
        }

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

    private fun enterUnpairedState() {
        releaseExoPlayer()
        playerView.visibility = View.GONE
        standbyImageView.visibility = View.GONE
        pairingContainer.visibility = View.VISIBLE
        codeBoxTextView.text = "------"
        pairingStatusTextView.text = "Solicitando código de enlace a ${getBaseUrl()}..."

        pairingJob = mainScope.launch {
            while (isActive && getPantallaId().isNullOrEmpty()) {
                val hardwareModel = "Android TV - ${Build.MANUFACTURER} ${Build.MODEL}"
                val requestResult = withContext(Dispatchers.IO) {
                    ApiClient.requestPairingCode(getBaseUrl(), hardwareModel)
                }

                if (requestResult != null && requestResult.codigoSeisDigitos.isNotBlank()) {
                    val code = requestResult.codigoSeisDigitos
                    codeBoxTextView.text = code
                    pairingStatusTextView.text = "Esperando vinculación en el panel administrativo (cada 2.5s)..."

                    var codeValid = true
                    while (isActive && codeValid) {
                        delay(PAIRING_POLL_INTERVAL_MS)
                        val statusResult = withContext(Dispatchers.IO) {
                            ApiClient.checkPairingStatus(getBaseUrl(), code)
                        } ?: continue

                        if (statusResult.httpCode == 404) {
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
                    pairingStatusTextView.text = "Reintentando conexión con ${getBaseUrl()}..."
                    delay(5_000L)
                }
            }
        }
    }

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

        if (syncResponse.httpCode == 404) {
            prefs.edit().remove(KEY_TV_ID).apply()
            currentPlaylistSignature = ""
            enterUnpairedState()
            return
        }

        if (!syncResponse.ok) return

        applyScreenOrientation(syncResponse.orientacion)

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

    private fun performHardRefreshF5() {
        Toast.makeText(
            this,
            "Sincronizando y refrescando pantalla...",
            Toast.LENGTH_SHORT
        ).show()

        releaseExoPlayer()
        currentPlaylistSignature = ""

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

        val btnRefreshF5 = createDpadButton(
            label = "🔄 Refrescar Pantalla (F5)",
            normalBg = "#1E293B",
            focusedBg = "#2563EB",
            focusedBorder = "#93C5FD"
        ) {
            dismissRemoteControlModal()
            performHardRefreshF5()
        }

        val btnContinue = createDpadButton(
            label = "No, continuar reproduciendo",
            normalBg = "#1E293B",
            focusedBg = "#334155",
            focusedBorder = "#F8FAFC"
        ) {
            dismissRemoteControlModal()
        }

        val btnExit = createDpadButton(
            label = "Sí, salir de la aplicación",
            normalBg = "#450A0A",
            focusedBg = "#DC2626",
            focusedBorder = "#FCA5A5"
        ) {
            dismissRemoteControlModal()
            performGracefulDisconnectAndExit()
        }

        val btnChangeServer = createDpadButton(
            label = "Cambiar Servidor Base (${getBaseUrl()})",
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
                countdownLabel.text = "Cierre automático de seguridad en ${seconds}s"
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
}
