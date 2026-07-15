import { Text } from "react-native";
import { Button, Card, Screen, textStyles } from "../components/ui";

export function ProfileScreen({
  accountLabel,
  onSignOut,
  busy,
}: {
  accountLabel: string | null;
  onSignOut: () => void;
  busy: boolean;
}) {
  return (
    <Screen title="Profil" kicker="Compte">
      <Card>
        <Text style={textStyles.label}>Connecte</Text>
        <Text style={[textStyles.heading, { marginTop: 6 }]}>{accountLabel ?? "Compte Moboko"}</Text>
      </Card>
      <Button label="Se deconnecter" onPress={onSignOut} loading={busy} secondary />
    </Screen>
  );
}
