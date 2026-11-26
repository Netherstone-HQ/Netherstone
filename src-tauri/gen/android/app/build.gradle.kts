import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// The release key stays off this repository. keystore.properties (beside
// settings.gradle, ignored by git) names it; without that file release builds
// are signed with the debug key, which phones accept for testing only.
val keystoreProperties = Properties().apply {
    val propFile = rootProject.file("keystore.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// Tauri's version code leaves out the beta number, so two betas of one
// version would share a code and app stores couldn't order them. Here a beta
// counts below its stable release, and the last digit is free for stores
// that build one APK per architecture (-PnetherstoneAbi=1..4).
fun versionCodeOf(name: String, fallback: Int): Int {
    val match = Regex("""^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$""").matchEntire(name)
        ?: return fallback
    val (major, minor, patch, beta) = match.destructured
    val release = if (beta.isEmpty()) 99 else beta.toInt().also { require(it < 99) { "Beta $it is past 98" } }
    val abi = findProperty("netherstoneAbi")?.toString()?.toInt() ?: 0
    return ((major.toInt() * 100 + minor.toInt()) * 100 + patch.toInt()) * 1000 + release * 10 + abi
}

android {
    compileSdk = 37
    namespace = "tech.blueblood.netherstone"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "tech.blueblood.netherstone"
        minSdk = 24
        targetSdk = 37
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
        versionCode = versionCodeOf(
            versionName!!,
            tauriProperties.getProperty("tauri.android.versionCode", "1").toInt(),
        )
        // Lets the emulator checks drive the page over DevTools. Only the CI
        // test build turns it on (ORG_GRADLE_PROJECT_netherstoneInspectable).
        buildConfigField(
            "boolean",
            "INSPECTABLE",
            (findProperty("netherstoneInspectable") == "true").toString()
        )
    }
    signingConfigs {
        if (!keystoreProperties.isEmpty) {
            create("release") {
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
            // Compressed native libraries: a smaller download, unpacked on install.
            packaging {
                jniLibs.useLegacyPackaging = true
            }
            optimization {
               enable = true
            }
            proguardFiles(
                *fileTree(".") {
                  include("**/*.pro")
                  exclude("build/**")
                }.files.toTypedArray()
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    buildFeatures {
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_1_8
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.browser:browser:1.8.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = file("tauri.build.gradle.kts"))
