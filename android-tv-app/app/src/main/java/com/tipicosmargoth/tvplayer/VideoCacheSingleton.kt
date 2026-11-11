package com.tipicosmargoth.tvplayer

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
}
