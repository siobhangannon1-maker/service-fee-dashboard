import PageLayout from "@/components/ui/PageLayout";
import UniversalClinicalScribeRulesClient from "./UniversalClinicalScribeRulesClient";

export default function UniversalClinicalScribeRulesPage() {
  return (
    <PageLayout
      eyebrow="AI Clinical Scribe"
      title="Universal Clinical Scribe Rules"
      description="Rules applied to all clinical scribe notes before provider-specific rules."
    >
      <UniversalClinicalScribeRulesClient />
    </PageLayout>
  );
}