const { withAndroidManifest } = require("@expo/config-plugins");

const SERVICE_NAME = "com.asterinet.react.bgactions.RNBackgroundActionsTask";

/**
 * react-native-background-actions declares its foreground service without a type, but
 * Android 14+ refuses to start a foreground service whose type is not declared in the
 * manifest. Vectorization is a data-processing job, so declare it as `dataSync`.
 */
module.exports = function withBackgroundActionsService(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$["xmlns:tools"] = "http://schemas.android.com/tools";

    const application = manifest.application?.[0];
    if (!application) return cfg;

    application.service = application.service ?? [];
    let service = application.service.find((item) => item.$?.["android:name"] === SERVICE_NAME);
    if (!service) {
      service = { $: { "android:name": SERVICE_NAME } };
      application.service.push(service);
    }
    service.$["android:foregroundServiceType"] = "dataSync";
    service.$["tools:node"] = "merge";
    return cfg;
  });
};
