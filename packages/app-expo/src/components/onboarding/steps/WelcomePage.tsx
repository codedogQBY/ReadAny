import { DarkModeSvg } from "@/components/DarkModeSvg";
import { useSettingsStore } from "@/stores";
import { useTheme } from "@/styles/theme";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Bot, Languages, Search } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ReadingSvg from "../../../../assets/illustrations/reading.svg";
import type { OnboardingStackParamList } from "../OnboardingNavigator";

type NavProp = NativeStackNavigationProp<OnboardingStackParamList, "Welcome">;

export function WelcomePage() {
  const { t } = useTranslation();
  const navigation = useNavigation<NavProp>();
  const { completeOnboarding } = useSettingsStore();
  const { isDark, colors } = useTheme();
  const insets = useSafeAreaInsets();

  const handleSkip = () => {
    completeOnboarding();
  };

  const handleNext = () => {
    navigation.navigate("Appearance");
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          entering={FadeInDown.delay(100).springify()}
          style={[styles.iconContainer, { backgroundColor: "transparent" }]}
        >
          <DarkModeSvg width={180} height={180}>
            <ReadingSvg width={180} height={180} />
          </DarkModeSvg>
        </Animated.View>

        <Animated.Text
          entering={FadeInDown.delay(200).springify()}
          style={[styles.title, { color: colors.foreground }]}
        >
          {t("onboarding.welcome.title", "Welcome to ReadAny")}
        </Animated.Text>
        <Animated.Text
          entering={FadeInDown.delay(300).springify()}
          style={[styles.subtitle, { color: colors.mutedForeground }]}
        >
          {t(
            "onboarding.welcome.desc",
            "The ultimate intelligent reading experience, uniquely yours.",
          )}
        </Animated.Text>

        <View style={styles.features}>
          {[
            {
              icon: <Bot size={24} color="#6366f1" />,
              title: t("onboarding.welcome.ai", "AI Co-pilot"),
              desc: t("onboarding.welcome.aiDesc", "Discuss books naturally with AI"),
            },
            {
              icon: <Search size={24} color="#10b981" />,
              title: t("onboarding.welcome.search", "Smart Search"),
              desc: t("onboarding.welcome.searchDesc", "Semantic knowledge retrieval"),
            },
            {
              icon: <Languages size={24} color="#f59e0b" />,
              title: t("onboarding.welcome.translate", "Instant Translation"),
              desc: t("onboarding.welcome.translateDesc", "Seamless bilingual reading"),
            },
          ].map((f, i) => (
            <Animated.View
              key={i}
              entering={FadeInDown.delay(400 + i * 100).springify()}
              style={styles.featureRow}
            >
              <View style={[styles.featureIcon, { backgroundColor: `${f.icon.props.color}20` }]}>
                {f.icon}
              </View>
              <View style={styles.featureText}>
                <Text style={[styles.featureTitle, { color: colors.foreground }]}>{f.title}</Text>
                <Text style={[styles.featureDesc, { color: colors.mutedForeground }]}>
                  {f.desc}
                </Text>
              </View>
            </Animated.View>
          ))}
        </View>
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            backgroundColor: colors.background,
            borderTopColor: colors.border,
            paddingBottom: 16 + insets.bottom,
          },
        ]}
      >
        <TouchableOpacity onPress={handleSkip} style={styles.skipBtn} activeOpacity={0.7}>
          <Text style={[styles.skipText, { color: colors.mutedForeground }]}>
            {t("onboarding.skip", "Skip")}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleNext}
          style={[styles.nextBtn, { backgroundColor: colors.primary }]}
          activeOpacity={0.7}
        >
          <Text style={[styles.nextText, { color: colors.primaryForeground }]}>
            {t("onboarding.getStarted", "Get Started")} →
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollView: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 40,
    alignItems: "center",
    paddingBottom: 24,
  },
  iconContainer: { marginBottom: 24 },
  title: { fontSize: 28, fontWeight: "800", textAlign: "center", marginBottom: 12 },
  subtitle: {
    fontSize: 16,
    textAlign: "center",
    marginBottom: 32,
    lineHeight: 24,
    paddingHorizontal: 12,
  },
  features: { width: "100%", marginBottom: 24 },
  featureRow: { flexDirection: "row", alignItems: "center", marginBottom: 20 },
  featureIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  featureText: { flex: 1 },
  featureTitle: { fontSize: 15, fontWeight: "600", marginBottom: 4 },
  featureDesc: { fontSize: 13, lineHeight: 18 },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderTopWidth: 1,
  },
  skipBtn: { paddingVertical: 12, paddingHorizontal: 16 },
  skipText: { fontSize: 16, fontWeight: "500" },
  nextBtn: { paddingVertical: 14, paddingHorizontal: 28, borderRadius: 999 },
  nextText: { fontSize: 16, fontWeight: "600" },
});
