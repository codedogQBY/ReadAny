import { Download, Maximize2, Minimize2, RotateCcw } from "@/components/ui/Icon";
import { useColors } from "@/styles/theme";
import type { ThemeColors } from "@/styles/theme";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import WebView, { type WebViewMessageEvent } from "react-native-webview";

interface MindmapViewProps {
  markdown: string;
  title?: string;
}

const safeSvgFilename = (name: string) => {
  const sanitized = name
    .replace(/[\\/:*?"<>|]/g, "_")
    .split("")
    .map((char) => (char.charCodeAt(0) < 32 ? "_" : char))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${sanitized || "mindmap"}.svg`;
};

const generateHtml = (markdown: string, colors: ThemeColors) => {
  const escapedMarkdown = markdown
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: ${colors.background};
      overscroll-behavior: none;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
    }
    #mindmap {
      width: 100%;
      height: 100%;
      touch-action: none;
      cursor: grab;
    }
    #mindmap:active { cursor: grabbing; }
    svg { width: 100%; height: 100%; }
    .markmap-node-circle { cursor: pointer; }
    .markmap-foreign { font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
    .markmap-foreign, .markmap-foreign * {
      color: ${colors.foreground} !important;
    }
  </style>
</head>
<body>
  <svg id="mindmap"></svg>
  <script src="https://cdn.jsdelivr.net/npm/markmap-autoloader@0.18.12/dist/index.js"></script>
  <script>
    (function() {
      var markdown = \`${escapedMarkdown}\`;
      var mm = null;
      var touchState = null;
      var suppressClickUntil = 0;

      function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
      }

      function getPoint(touch, svg) {
        var rect = svg.getBoundingClientRect();
        return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
      }

      function getDistance(a, b) {
        var dx = a.x - b.x;
        var dy = a.y - b.y;
        return Math.sqrt(dx * dx + dy * dy);
      }

      function getCenter(a, b) {
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }

      function getCurrentTransform() {
        var g = document.querySelector('#mindmap > g');
        if (!g) return { x: 0, y: 0, k: 1 };
        var transform = g.transform && g.transform.baseVal.consolidate();
        if (!transform) return { x: 0, y: 0, k: 1 };
        var matrix = transform.matrix;
        return { x: matrix.e, y: matrix.f, k: matrix.a || 1 };
      }

      function applyTransform(transform) {
        var g = document.querySelector('#mindmap > g');
        if (!g) return;
        g.setAttribute(
          'transform',
          'translate(' + transform.x + ',' + transform.y + ') scale(' + transform.k + ')'
        );
      }

      function installTouchPanFallback() {
        var svg = document.querySelector('#mindmap');
        if (!svg || svg.dataset.touchFallback === '1') return;
        svg.dataset.touchFallback = '1';

        svg.addEventListener('click', function(event) {
          if (Date.now() < suppressClickUntil) {
            event.preventDefault();
            event.stopPropagation();
          }
        }, true);

        svg.addEventListener('touchstart', function(event) {
          if (!event.touches || event.touches.length === 0) return;
          var current = getCurrentTransform();
          if (event.touches.length === 1) {
            touchState = {
              type: 'pan',
              start: getPoint(event.touches[0], svg),
              transform: current,
              moved: false
            };
          } else {
            var first = getPoint(event.touches[0], svg);
            var second = getPoint(event.touches[1], svg);
            touchState = {
              type: 'pinch',
              center: getCenter(first, second),
              distance: getDistance(first, second),
              transform: current,
              moved: false
            };
          }
        }, { passive: false });

        svg.addEventListener('touchmove', function(event) {
          if (!touchState || !event.touches || event.touches.length === 0) return;

          if (touchState.type === 'pan' && event.touches.length === 1) {
            var point = getPoint(event.touches[0], svg);
            var dx = point.x - touchState.start.x;
            var dy = point.y - touchState.start.y;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) touchState.moved = true;
            applyTransform({
              x: touchState.transform.x + dx,
              y: touchState.transform.y + dy,
              k: touchState.transform.k
            });
            event.preventDefault();
            event.stopPropagation();
            return;
          }

          if (touchState.type === 'pinch' && event.touches.length >= 2) {
            var first = getPoint(event.touches[0], svg);
            var second = getPoint(event.touches[1], svg);
            var center = getCenter(first, second);
            var distance = getDistance(first, second);
            var nextScale = clamp(touchState.transform.k * (distance / touchState.distance), 0.2, 6);
            var scaleRatio = nextScale / touchState.transform.k;
            touchState.moved = true;
            applyTransform({
              x: center.x - (touchState.center.x - touchState.transform.x) * scaleRatio,
              y: center.y - (touchState.center.y - touchState.transform.y) * scaleRatio,
              k: nextScale
            });
            event.preventDefault();
            event.stopPropagation();
          }
        }, { passive: false });

        svg.addEventListener('touchend', function() {
          if (touchState && touchState.moved) {
            suppressClickUntil = Date.now() + 120;
          }
          touchState = null;
        }, { passive: true });

        svg.addEventListener('touchcancel', function() {
          touchState = null;
        }, { passive: true });
      }

      function getStandaloneSvg() {
        var svgEl = document.querySelector('#mindmap');
        if (!svgEl) return '';

        var originalG = svgEl.querySelector('g');
        var bbox = { x: -200, y: -200, width: 800, height: 600 };
        try {
          if (originalG) bbox = originalG.getBBox();
        } catch(e) {}

        var padding = 50;
        var contentX = bbox.x - padding;
        var contentY = bbox.y - padding;
        var contentWidth = Math.max(1, bbox.width + padding * 2);
        var contentHeight = Math.max(1, bbox.height + padding * 2);
        var cloned = svgEl.cloneNode(true);
        var clonedG = cloned.querySelector('g');

        if (clonedG) {
          clonedG.setAttribute('transform', 'translate(0,0) scale(1)');
        }

        cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        cloned.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
        cloned.setAttribute('viewBox', contentX + ' ' + contentY + ' ' + contentWidth + ' ' + contentHeight);
        cloned.setAttribute('width', String(contentWidth));
        cloned.setAttribute('height', String(contentHeight));
        cloned.style.width = '';
        cloned.style.height = '';

        cloned.querySelectorAll('foreignObject *').forEach(function(el) {
          el.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
        });

        var bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bgRect.setAttribute('x', String(contentX));
        bgRect.setAttribute('y', String(contentY));
        bgRect.setAttribute('width', String(contentWidth));
        bgRect.setAttribute('height', String(contentHeight));
        bgRect.setAttribute('fill', '${colors.background}');
        cloned.insertBefore(bgRect, cloned.firstChild);

        var style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
        style.textContent = '.markmap-foreign,.markmap-foreign *{color:${colors.foreground}!important;font-family:-apple-system,BlinkMacSystemFont,sans-serif;} .markmap-node-circle{fill:${colors.background};}';
        cloned.insertBefore(style, cloned.firstChild);

        var svgData = new XMLSerializer().serializeToString(cloned);
        if (!svgData.startsWith('<?xml')) {
          svgData = '<?xml version="1.0" encoding="UTF-8"?>\\n' + svgData;
        }
        return svgData;
      }

      function init() {
        if (!window.markmap || !window.markmap.Transformer || !window.markmap.Markmap) {
          setTimeout(init, 100);
          return;
        }

        try {
          var Transformer = window.markmap.Transformer;
          var Markmap = window.markmap.Markmap;

          var transformer = new Transformer();
          var result = transformer.transform(markdown);

          mm = Markmap.create('#mindmap', {
            autoFit: true,
            duration: 300,
            maxWidth: 200,
            color: function(node) {
              return '${colors.primary}';
            }
          }, result.root);

          window._markmap = mm;
          installTouchPanFallback();

          window.getSvgContent = function() {
            return getStandaloneSvg();
          };

          window.resetView = function() {
            if (mm) {
              mm.fit().then(function() {
                setTimeout(installTouchPanFallback, 0);
              });
            }
          };

          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'loaded' }));
        } catch (err) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'error',
            message: 'Error initializing mindmap: ' + err.message
          }));
        }
      }

      if (document.readyState === 'complete') {
        init();
      } else {
        window.addEventListener('load', init);
      }
    })();
  </script>
</body>
</html>`;
};

export function MindmapView({ markdown, title }: MindmapViewProps) {
  const colors = useColors();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const webviewRef = useRef<WebView>(null);
  const fullscreenWebviewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [fullscreenLoading, setFullscreenLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const html = useMemo(() => generateHtml(markdown, colors), [markdown, colors]);

  const handleReset = useCallback(() => {
    const target = expanded ? fullscreenWebviewRef.current : webviewRef.current;
    target?.injectJavaScript(`
      (function() {
        if (window.resetView) {
          window.resetView();
        }
      })();
      true;
    `);
  }, [expanded]);

  const handleDownload = useCallback(async () => {
    const target = expanded ? fullscreenWebviewRef.current : webviewRef.current;
    target?.injectJavaScript(`
      (function() {
        const svgContent = window.getSvgContent();
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'svg', content: svgContent }));
      })();
      true;
    `);
  }, [expanded]);

  const openFullscreen = useCallback(() => {
    setFullscreenLoading(true);
    setExpanded(true);
  }, []);

  const handleMessage = useCallback(
    async (event: WebViewMessageEvent, fullscreen: boolean) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (data.type === "loaded") {
          if (fullscreen) {
            setFullscreenLoading(false);
          } else {
            setLoading(false);
          }
        } else if (data.type === "error") {
          console.error("Mindmap error:", data.message);
          if (fullscreen) {
            setFullscreenLoading(false);
          } else {
            setLoading(false);
          }
        } else if (data.type === "svg") {
          const filename = safeSvgFilename(title || t("mindmap.title", "思维导图"));
          const filepath = `${FileSystem.documentDirectory}${filename}`;
          await FileSystem.writeAsStringAsync(filepath, data.content, {
            encoding: FileSystem.EncodingType.UTF8,
          });
          await Sharing.shareAsync(filepath, { mimeType: "image/svg+xml" });
        }
      } catch (e) {
        console.error("WebView message error:", e);
      }
    },
    [title, t],
  );

  const displayTitle = title && title.length > 20 ? `${title.slice(0, 20)}...` : title;

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
          {displayTitle || t("mindmap.title", "思维导图")}
        </Text>
        <View style={styles.controls}>
          <TouchableOpacity onPress={handleReset} style={styles.button}>
            <RotateCcw size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <TouchableOpacity onPress={handleDownload} style={styles.button}>
            <Download size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
          <TouchableOpacity onPress={openFullscreen} style={styles.button}>
            <Maximize2 size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.webviewContainer}>
        {loading && (
          <View style={[styles.loading, { backgroundColor: colors.card }]}>
            <ActivityIndicator color={colors.foreground} />
          </View>
        )}
        <WebView
          ref={webviewRef}
          source={{ html }}
          style={styles.webview}
          onLoadEnd={() => setLoading(false)}
          onMessage={(event) => handleMessage(event, false)}
          scrollEnabled={true}
          nestedScrollEnabled={true}
          bounces={false}
          overScrollMode="never"
          originWhitelist={["*"]}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          mixedContentMode="compatibility"
        />
      </View>

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>
          {t("mindmap.zoomHintMindmap", "双指缩放 · 拖动移动 · 点击节点展开/收起")}
        </Text>
      </View>

      {expanded && (
        <Modal visible animationType="fade" onRequestClose={() => setExpanded(false)}>
          <View
            style={[
              styles.fullscreen,
              {
                backgroundColor: colors.background,
                paddingTop: insets.top,
                paddingBottom: insets.bottom,
              },
            ]}
          >
            <View style={[styles.fullscreenHeader, { borderBottomColor: colors.border }]}>
              <Text
                style={[styles.fullscreenTitle, { color: colors.foreground }]}
                numberOfLines={1}
              >
                {displayTitle || t("mindmap.title", "思维导图")}
              </Text>
              <View style={styles.controls}>
                <TouchableOpacity onPress={handleReset} style={styles.button}>
                  <RotateCcw size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
                <TouchableOpacity onPress={handleDownload} style={styles.button}>
                  <Download size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setExpanded(false)} style={styles.button}>
                  <Minimize2 size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.fullscreenWebviewContainer}>
              {fullscreenLoading && (
                <View style={[styles.loading, { backgroundColor: colors.background }]}>
                  <ActivityIndicator color={colors.foreground} />
                </View>
              )}
              <WebView
                ref={fullscreenWebviewRef}
                source={{ html }}
                style={styles.webview}
                onLoadEnd={() => setFullscreenLoading(false)}
                onMessage={(event) => handleMessage(event, true)}
                scrollEnabled={true}
                nestedScrollEnabled={true}
                bounces={false}
                overScrollMode="never"
                originWhitelist={["*"]}
                javaScriptEnabled={true}
                domStorageEnabled={true}
                mixedContentMode="compatibility"
              />
            </View>
            <View style={[styles.footer, { borderTopColor: colors.border }]}>
              <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                {t("mindmap.zoomHintMindmap", "双指缩放 · 拖动移动 · 点击节点展开/收起")}
              </Text>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
    marginVertical: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: "500",
    flex: 1,
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  button: {
    padding: 6,
    borderRadius: 4,
  },
  divider: {
    width: 1,
    height: 16,
    marginHorizontal: 4,
  },
  webviewContainer: {
    height: 300,
    overflow: "hidden",
  },
  webview: {
    flex: 1,
    backgroundColor: "transparent",
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1,
  },
  footer: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
  },
  hint: {
    fontSize: 13,
  },
  fullscreen: {
    flex: 1,
  },
  fullscreenHeader: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  fullscreenTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
  },
  fullscreenWebviewContainer: {
    flex: 1,
    overflow: "hidden",
  },
});
