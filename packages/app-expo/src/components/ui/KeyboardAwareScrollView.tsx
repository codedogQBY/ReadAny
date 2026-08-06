import { StyleSheet, type ViewStyle } from "react-native";
import {
  KeyboardAwareScrollView as ControllerKeyboardAwareScrollView,
  type KeyboardAwareScrollViewProps as ControllerKeyboardAwareScrollViewProps,
} from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { spacing } from "../../styles/theme";

interface KeyboardAwareScrollViewProps extends ControllerKeyboardAwareScrollViewProps {
  contentBottomInset?: number;
}

export function KeyboardAwareScrollView({
  children,
  contentContainerStyle,
  contentBottomInset = spacing.xl,
  bottomOffset = spacing.md,
  keyboardShouldPersistTaps = "handled",
  keyboardDismissMode = "on-drag",
  ...props
}: KeyboardAwareScrollViewProps) {
  const safeAreaInsets = useSafeAreaInsets();
  const flattenedContent = StyleSheet.flatten(contentContainerStyle) as ViewStyle | undefined;
  const existingPaddingBottom =
    typeof flattenedContent?.paddingBottom === "number" ? flattenedContent.paddingBottom : 0;

  return (
    <ControllerKeyboardAwareScrollView
      {...props}
      bottomOffset={bottomOffset}
      contentContainerStyle={[
        contentContainerStyle,
        {
          paddingBottom: existingPaddingBottom + contentBottomInset + safeAreaInsets.bottom,
        },
      ]}
      keyboardDismissMode={keyboardDismissMode}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
    >
      {children}
    </ControllerKeyboardAwareScrollView>
  );
}
