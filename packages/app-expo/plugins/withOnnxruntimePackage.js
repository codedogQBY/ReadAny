const { withMainApplication } = require("@expo/config-plugins");

const IMPORT = "import ai.onnxruntime.reactnative.OnnxruntimePackage";
const PACKAGE = "add(OnnxruntimePackage())";

/**
 * onnxruntime-react-native's bundled Expo plugin adds the Gradle dependency,
 * but does not add its legacy ReactPackage to RN's generated PackageList.
 * Register it in MainApplication so NativeModules.Onnxruntime is available.
 */
module.exports = function withOnnxruntimePackage(config) {
  return withMainApplication(config, (cfg) => {
    if (cfg.modResults.language !== "kt") {
      throw new Error("withOnnxruntimePackage requires Kotlin MainApplication");
    }

    let source = cfg.modResults.contents;
    if (!source.includes(IMPORT)) {
      source = source.replace(
        "import android.content.res.Configuration",
        `import android.content.res.Configuration\n${IMPORT}`,
      );
    }
    if (!source.includes(PACKAGE)) {
      source = source.replace(
        "// add(MyReactNativePackage())",
        `// add(MyReactNativePackage())\n              ${PACKAGE}`,
      );
    }
    cfg.modResults.contents = source;
    return cfg;
  });
};
