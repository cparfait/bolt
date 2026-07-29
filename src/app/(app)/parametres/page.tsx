import { getGeneralSettings } from "@/lib/settings";
import { Card } from "@/components/ui";
import { GeneralForm } from "@/components/settings-forms";

export default async function ParametresGeneraux() {
  const cfg = await getGeneralSettings();
  return (
    <Card title="Paramètres généraux">
      <GeneralForm cfg={cfg} />
    </Card>
  );
}
