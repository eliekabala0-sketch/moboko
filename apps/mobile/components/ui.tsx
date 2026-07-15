import { mobokoTheme } from "@moboko/shared";
import { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

export function Screen({
  title,
  kicker,
  children,
}: {
  title: string;
  kicker?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.screen}>
      {kicker ? <Text style={styles.kicker}>{kicker}</Text> : null}
      <Text style={styles.title}>{title}</Text>
      {children}
    </View>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function Button({
  label,
  onPress,
  disabled,
  loading,
  secondary,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={[secondary ? styles.secondaryButton : styles.primaryButton, (disabled || loading) && styles.disabled]}
    >
      {loading ? (
        <ActivityIndicator color={secondary ? mobokoTheme.colors.accent : "#f4f6fb"} />
      ) : (
        <Text style={secondary ? styles.secondaryText : styles.primaryText}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Field({
  value,
  onChangeText,
  placeholder,
  multiline,
  secureTextEntry,
  keyboardType,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "email-address" | "number-pad" | "phone-pad";
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={mobokoTheme.colors.textMuted}
      multiline={multiline}
      secureTextEntry={secureTextEntry}
      keyboardType={keyboardType}
      autoCapitalize={keyboardType === "email-address" ? "none" : "sentences"}
      style={[styles.input, multiline && styles.textarea]}
    />
  );
}

export function Notice({ text, kind = "info" }: { text: string | null; kind?: "info" | "error" | "success" }) {
  if (!text) return null;
  return (
    <View style={[styles.notice, kind === "error" && styles.noticeError, kind === "success" && styles.noticeSuccess]}>
      <Text style={[styles.noticeText, kind === "error" && styles.errorText]}>{text}</Text>
    </View>
  );
}

export const textStyles = StyleSheet.create({
  muted: { color: mobokoTheme.colors.textMuted, fontSize: 13, lineHeight: 19 },
  body: { color: mobokoTheme.colors.text, fontSize: 15, lineHeight: 22 },
  label: { color: mobokoTheme.colors.accent, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.2 },
  heading: { color: mobokoTheme.colors.text, fontSize: 18, fontWeight: "700" },
});

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: mobokoTheme.space.md,
    paddingTop: mobokoTheme.space.md,
    paddingBottom: 96,
    backgroundColor: mobokoTheme.colors.background,
  },
  kicker: {
    color: mobokoTheme.colors.accent,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2.4,
    textTransform: "uppercase",
  },
  title: {
    marginTop: 6,
    marginBottom: 14,
    color: mobokoTheme.colors.text,
    fontSize: 26,
    fontWeight: "700",
  },
  card: {
    borderWidth: 1,
    borderColor: mobokoTheme.colors.border,
    backgroundColor: mobokoTheme.colors.surface,
    borderRadius: mobokoTheme.radii.md,
    padding: mobokoTheme.space.md,
    marginBottom: mobokoTheme.space.md,
  },
  primaryButton: {
    minHeight: 46,
    borderRadius: mobokoTheme.radii.full,
    backgroundColor: mobokoTheme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    marginTop: 8,
  },
  secondaryButton: {
    minHeight: 44,
    borderRadius: mobokoTheme.radii.full,
    borderWidth: 1,
    borderColor: mobokoTheme.colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    marginTop: 8,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  primaryText: { color: "#f4f6fb", fontWeight: "700", fontSize: 14 },
  secondaryText: { color: mobokoTheme.colors.accent, fontWeight: "700", fontSize: 14 },
  disabled: { opacity: 0.45 },
  input: {
    minHeight: 46,
    borderRadius: mobokoTheme.radii.md,
    borderWidth: 1,
    borderColor: mobokoTheme.colors.border,
    backgroundColor: "rgba(255,255,255,0.04)",
    color: mobokoTheme.colors.text,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    marginBottom: 10,
  },
  textarea: { minHeight: 110, textAlignVertical: "top" },
  notice: {
    borderWidth: 1,
    borderColor: mobokoTheme.colors.border,
    borderRadius: mobokoTheme.radii.md,
    padding: 12,
    marginBottom: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  noticeError: { borderColor: "rgba(224,120,120,0.35)", backgroundColor: "rgba(224,120,120,0.12)" },
  noticeSuccess: { borderColor: "rgba(107,206,160,0.35)", backgroundColor: "rgba(107,206,160,0.12)" },
  noticeText: { color: mobokoTheme.colors.textMuted, fontSize: 13, lineHeight: 18 },
  errorText: { color: mobokoTheme.colors.danger },
});
