import type { RootStackParamList } from "@/navigation/RootNavigator";
/**
 * navigationRef — allows navigation outside of React component tree.
 * Pass this ref to <NavigationContainer ref={navigationRef}> in App.tsx.
 */
import { createNavigationContainerRef } from "@react-navigation/native";
import { StackActions } from "@react-navigation/native";

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function navigate<RouteName extends keyof RootStackParamList>(
  name: RouteName,
  params?: RootStackParamList[RouteName],
) {
  if (navigationRef.isReady()) {
    navigationRef.navigate(name as any, params as any);
  }
}

export function pushRoute<RouteName extends keyof RootStackParamList>(
  name: RouteName,
  params?: RootStackParamList[RouteName],
) {
  if (navigationRef.isReady()) {
    navigationRef.dispatch(StackActions.push(name as string, params as object | undefined));
  }
}
