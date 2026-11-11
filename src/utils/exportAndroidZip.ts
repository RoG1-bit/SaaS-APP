import JSZip from 'jszip';
import { ANDROID_PROJECT_FILES } from '../data/androidProjectFiles';

export async function downloadAndroidStudioProjectZip(): Promise<void> {
  const zip = new JSZip();
  const rootFolder = zip.folder('TipicosMargoth-AndroidTV');

  if (!rootFolder) return;

  // Agregar todos los archivos principales del proyecto Android TV
  for (const file of ANDROID_PROJECT_FILES) {
    rootFolder.file(file.path, file.content);
  }

  // Agregar settings.gradle.kts en la raíz
  rootFolder.file(
    'settings.gradle.kts',
    `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "TipicosMargothTVPlayer"
include(":app")
`
  );

  // Agregar build.gradle.kts en la raíz
  rootFolder.file(
    'build.gradle.kts',
    `plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
}
`
  );

  // Agregar gradle.properties
  rootFolder.file(
    'gradle.properties',
    `org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
android.useAndroidX=true
kotlin.code.style=official
android.nonTransitiveRClass=true
`
  );

  // Agregar proguard-rules.pro
  rootFolder.file(
    'app/proguard-rules.pro',
    `-keep class com.tipicosmargoth.tvplayer.** { *; }
-dontwarn androidx.media3.**
`
  );

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'TipicosMargoth-AndroidTV-Project.zip';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
