import { getGeneralSettings } from "@/lib/settings";
import { requireUser } from "@/lib/session";
import { Card } from "@/components/ui";
import { GeneralForm } from "@/components/settings-forms";

export default async function ParametresGeneraux() {
  const user = await requireUser("GESTIONNAIRE");
  const cfg = await getGeneralSettings();
  return (
    <Card title="Paramètres généraux">
      <GeneralForm cfg={cfg} estAdmin={user.role === "ADMIN"} />
    </Card>
  );
}
