const { getAppVariantConfig } = require("./scripts/app-variant");

const variant = getAppVariantConfig();

module.exports = {
  expo: {
    name: variant.name,
    slug: "readany",
    version: "1.3.4",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    splash: {
      image: "./assets/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#05042B",
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: variant.bundleIdentifier,
      buildNumber: "2",
      infoPlist: {
        UIBackgroundModes: ["audio"],
        NSCameraUsageDescription:
          "ReadAny uses the camera to scan sync and configuration QR codes.",
        NSLocalNetworkUsageDescription:
          "ReadAny uses the local network to connect to sync devices and the development server while debugging.",
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#05042B",
      },
      softwareKeyboardLayoutMode: "resize",
      package: variant.androidPackage,
      permissions: [
        "android.permission.CAMERA",
        "android.permission.RECORD_AUDIO",
        "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
        "android.permission.MODIFY_AUDIO_SETTINGS",
      ],
    },
    plugins: [
      [
        "expo-dev-client",
        {
          launchMode: "launcher",
        },
      ],
      [
        "expo-av",
        {
          microphonePermission: false,
        },
      ],
      [
        "expo-build-properties",
        {
          android: {
            enableProguardInReleaseBuilds: true,
            enableShrinkResourcesInReleaseBuilds: true,
            enableMinifyInReleaseBuilds: true,
            usesCleartextTraffic: true,
          },
        },
      ],
      "expo-font",
      [
        "expo-image-picker",
        {
          photosPermission: "ReadAny uses your photo library to choose custom book covers.",
        },
      ],
      "expo-secure-store",
      "expo-sqlite",
      "expo-asset",
      "./plugins/withVolumeKeyPaging",
      [
        "expo-camera",
        {
          cameraPermission: "Allow ReadAny to use your camera to scan sync QR codes.",
        },
      ],
    ],
    scheme: variant.scheme,
    extra: {
      appVariant: variant.key,
      eas: {
        projectId: "e9c65825-d965-4d58-a3af-46406ee8a9ae",
      },
    },
  },
};
