package com.tipicosmargoth.tvplayer

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

    private const val USER_AGENT =
        "Mozilla/5.0 (Linux; Android 13; Chromecast HD) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

    /**
     * Normaliza URLs como "https//:panel.aryessv.com/tv" o "https://panel.aryessv.com/tv"
     * al origen limpio del backend ("https://panel.aryessv.com").
     */
    fun normalizeApiOrigin(rawBaseUrl: String): String {
        var cleaned = rawBaseUrl.trim()
            .replace("https//:", "https://", ignoreCase = true)
            .replace("http//:", "http://", ignoreCase = true)
        if (!cleaned.startsWith("http://", true) && !cleaned.startsWith("https://", true)) {
            cleaned = "https://$cleaned"
        }
        cleaned = cleaned.trimEnd('/')
        if (cleaned.endsWith("/tv", ignoreCase = true)) {
            cleaned = cleaned.substring(0, cleaned.length - 3)
        }
        return cleaned.ifBlank { "https://panel.aryessv.com" }
    }

    private fun openConfiguredConnection(endpoint: String, method: String): HttpURLConnection {
        return (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            instanceFollowRedirects = true
            connectTimeout = 10_000
            readTimeout = 12_000
            setRequestProperty("User-Agent", USER_AGENT)
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Cache-Control", "no-cache")
        }
    }

    fun requestPairingCode(baseUrl: String, modeloHardware: String): PairingCodeResponse? {
        val origin = normalizeApiOrigin(baseUrl)
        val endpoint = "$origin/api/pairing/request-code"
        return try {
            val conn = openConfiguredConnection(endpoint, "POST").apply {
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=UTF-8")
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
                val sesion = json.optJSONObject("sesionTV") ?: json
                val codigo = sesion.optString("codigoSeisDigitos")
                    .ifBlank { sesion.optString("codigo") }
                    .ifBlank { json.optString("codigoSeisDigitos") }
                if (codigo.isBlank()) return null

                PairingCodeResponse(
                    ok = json.optBoolean("ok", true),
                    codigoSeisDigitos = codigo,
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

    fun checkPairingStatus(baseUrl: String, codigoSeisDigitos: String): PairingStatusResponse? {
        val origin = normalizeApiOrigin(baseUrl)
        val endpoint = "$origin/api/pairing/status/$codigoSeisDigitos"
        return try {
            val conn = openConfiguredConnection(endpoint, "GET")
            val code = conn.responseCode

            if (code == 404) {
                return PairingStatusResponse(404, false, "EXPIRADO", null)
            }

            if (code in 200..299) {
                val json = JSONObject(readStream(conn))
                val sesion = json.optJSONObject("sesionTV") ?: json
                val estado = sesion.optString("estado", "ESPERANDO_VINCULACION")

                val dispObj = sesion.optJSONObject("dispositivoVinculado")
                    ?: json.optJSONObject("dispositivoVinculado")
                    ?: json.optJSONObject("dispositivo")
                    ?: json.optJSONObject("pantalla")

                val dispId = (
                    dispObj?.optString("id")
                        ?: sesion.optString("pantallaId")
                        ?: json.optString("pantallaId")
                    )?.takeIf { it.isNotBlank() }

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

    fun syncTvPlayer(baseUrl: String, pantallaId: String): SyncTvResponse? {
        val origin = normalizeApiOrigin(baseUrl)
        val endpoint = "$origin/api/tv-player/sync/$pantallaId"
        return try {
            val conn = openConfiguredConnection(endpoint, "GET")
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
                val orientacion =
                    pantallaObj?.optString("orientacion", "HORIZONTAL_16_9") ?: "HORIZONTAL_16_9"

                val videoAsignadoObj = json.optJSONObject("videoAsignado")
                val videoAsignado = if (videoAsignadoObj != null) {
                    val url = videoAsignadoObj.optString("previewUrl")
                        .ifBlank { videoAsignadoObj.optString("url") }
                    if (url.isNotBlank()) {
                        VideoPayload(
                            id = videoAsignadoObj.optString("id", "video"),
                            titulo = videoAsignadoObj.optString("titulo", "Promoción"),
                            previewUrl = url
                        )
                    } else null
                } else null

                val playlistList = mutableListOf<VideoPayload>()
                val playlistArr = json.optJSONArray("playlistVideos")
                if (playlistArr != null) {
                    for (i in 0 until playlistArr.length()) {
                        val item = playlistArr.optJSONObject(i) ?: continue
                        val url = item.optString("previewUrl").ifBlank { item.optString("url") }
                        if (url.isBlank()) continue
                        playlistList.add(
                            VideoPayload(
                                id = item.optString("id", "vid-$i"),
                                titulo = item.optString("titulo", "Video $i"),
                                previewUrl = url
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

    fun disconnectTvPlayer(baseUrl: String, pantallaId: String): Boolean {
        val origin = normalizeApiOrigin(baseUrl)
        val endpoint = "$origin/api/tv-player/disconnect/$pantallaId"
        return try {
            val conn = openConfiguredConnection(endpoint, "POST").apply {
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
}
