const { withMainActivity } = require("@expo/config-plugins");

const MARKER = "// volume-key-paging:dispatchKeyEvent";

const DISPATCH = `
  ${MARKER}
  override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
    val keyCode = event.keyCode
    val isVolume = keyCode == android.view.KeyEvent.KEYCODE_VOLUME_UP ||
      keyCode == android.view.KeyEvent.KEYCODE_VOLUME_DOWN
    if (expo.modules.volumekeypaging.VolumeKeyPagingState.enabled &&
        expo.modules.volumekeypaging.VolumeKeyPagingState.emitter != null &&
        isVolume && hasWindowFocus() && !isInMultiWindowMode) {
      if (event.action == android.view.KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
        val direction =
          if (keyCode == android.view.KeyEvent.KEYCODE_VOLUME_UP) "prev" else "next"
        expo.modules.volumekeypaging.VolumeKeyPagingState.emitter?.invoke(direction)
      }
      return true
    }
    return super.dispatchKeyEvent(event)
  }
`;

module.exports = function withVolumeKeyPaging(config) {
  return withMainActivity(config, (cfg) => {
    if (cfg.modResults.language !== "kt") {
      throw new Error("withVolumeKeyPaging: MainActivity 需为 Kotlin（SDK 54 默认 kt）");
    }
    let src = cfg.modResults.contents;
    if (src.includes(MARKER)) return cfg; // 幂等
    const anchor = /class\s+MainActivity\s*:\s*ReactActivity[\s\S]*?\{/;
    if (!anchor.test(src)) {
      throw new Error("withVolumeKeyPaging: 未找到 MainActivity 类声明锚点");
    }
    src = src.replace(anchor, (m) => `${m}\n${DISPATCH}`);
    cfg.modResults.contents = src;
    return cfg;
  });
};
