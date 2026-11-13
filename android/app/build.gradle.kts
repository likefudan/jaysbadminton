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

    signingConfigs {
        // Test builds only: a throwaway key kept in the repository so every test build installs over
        // the last one. The Play release is signed with another key that is never committed.
        create("test") {
            storeFile = file("test.keystore")
            storePassword = "badminton-test"
            keyAlias = "test"
            keyPassword = "badminton-test"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("test")
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
