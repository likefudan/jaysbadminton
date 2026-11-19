plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.llmat.badminton"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.llmat.badminton"
        // Health Connect needs Android 9.
        minSdk = 28
        targetSdk = 35
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "0.1-test"
    }

    // Test builds: the workflow hands over a key kept in the repository's secrets, so every test
    // build installs over the last one. Without it (a fork, a laptop) the build is signed with
    // that machine's own debug key. No key is kept in the repository; the Play release has its own.
    val testKeystore = System.getenv("ANDROID_TEST_KEYSTORE")?.takeIf { it.isNotEmpty() && file(it).exists() }
    signingConfigs {
        if (testKeystore != null) {
            create("test") {
                storeFile = file(testKeystore)
                storePassword = System.getenv("ANDROID_TEST_KEYSTORE_PASSWORD")
                keyAlias = "test"
                keyPassword = System.getenv("ANDROID_TEST_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            if (testKeystore != null) signingConfig = signingConfigs.getByName("test")
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
    implementation("androidx.health.connect:connect-client:1.1.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
}
