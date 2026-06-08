import { BookOpenIcon, MessageSquareIcon, NotebookPenIcon, UserIcon } from "@/components/ui/Icon";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { ChatScreen } from "@/screens/ChatScreen";
import { LibraryScreen } from "@/screens/LibraryScreen";
import { NotesScreen } from "@/screens/NotesScreen";
import { ProfileScreen } from "@/screens/ProfileScreen";
import { useTheme } from "@/styles/ThemeContext";
/**
 * TabNavigator — bottom tab bar matching the Tauri mobile app's 4 tabs.
 * Icons: BookOpen, MessageSquare, NotebookPen, User (matching BottomTabBar.tsx)
 */
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useTranslation } from "react-i18next";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type TabParamList = {
  Library: undefined;
  Chat: undefined;
  Notes: { bookId?: string } | undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

export function TabNavigator() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();

  const androidNavigationFallback =
    Platform.OS === "android" ? (insets.bottom > 0 ? 28 : layout.isTablet ? 32 : 40) : 0;

  // Some Android devices under-report or completely miss the bottom inset when
  // classic three-button navigation is enabled, so we keep a larger fallback
  // reserve in that case to stop the system bar from covering the tab bar.
  const bottomInset =
    Platform.OS === "android" ? Math.max(insets.bottom, androidNavigationFallback) : insets.bottom;

  const baseTabBarHeight = layout.isTabletLandscape ? 72 : layout.isTablet ? 76 : 60;
  const tabBarHeight = baseTabBarHeight + bottomInset;

  return (
    <Tab.Navigator
      safeAreaInsets={{ ...insets, bottom: bottomInset }}
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarLabelStyle: {
          fontSize: layout.isTablet ? 13 : 12,
          fontWeight: "500",
          marginBottom: layout.isTabletLandscape ? 2 : 0,
        },
        tabBarItemStyle: layout.isTabletLandscape ? { paddingHorizontal: 10 } : undefined,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          borderTopWidth: 0.5,
          paddingTop: layout.isTabletLandscape ? 8 : 4,
          paddingBottom: bottomInset,
          height: tabBarHeight,
        },
        sceneStyle: {
          paddingBottom: Platform.OS === "android" && insets.bottom === 0 ? 4 : 0,
        },
      }}
    >
      <Tab.Screen
        name="Library"
        component={LibraryScreen}
        options={{
          tabBarLabel: t("tabs.library", "书架"),
          tabBarIcon: ({ color, size }) => <BookOpenIcon color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Chat"
        component={ChatScreen}
        options={{
          tabBarLabel: t("tabs.ai", "AI"),
          tabBarIcon: ({ color, size }) => <MessageSquareIcon color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Notes"
        component={NotesScreen}
        options={{
          tabBarLabel: t("tabs.notes", "笔记"),
          tabBarIcon: ({ color, size }) => <NotebookPenIcon color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarLabel: t("tabs.profile", "我的"),
          tabBarIcon: ({ color, size }) => <UserIcon color={color} size={size} />,
        }}
      />
    </Tab.Navigator>
  );
}
