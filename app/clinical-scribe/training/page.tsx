import PageLayout from "@/components/ui/PageLayout";
import { getProviderDashboardMetrics } from "@/lib/providers/get-provider-dashboard-metrics";
import ProviderScribeTrainingClient from "./ProviderScribeTrainingClient";

export default async function ProviderScribeTrainingPage() {
  const dashboard = await getProviderDashboardMetrics({
    module: "clinical",
    periodType: "month",
    periodKey: null,
  });

  if (!dashboard) {
    return (
      <PageLayout
        eyebrow="AI Clinical Scribe"
        title="Scribe training unavailable"
        description="This page is only available to linked providers."
      >
        <div className="mx-auto max-w-3xl rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
          We could not find a provider record linked to your current login.
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      eyebrow="AI Clinical Scribe"
      title="Scribe Training"
      description="Manage appointment types, templates, rules and example clinical notes."
    >
      <ProviderScribeTrainingClient providerId={dashboard.provider.id} />
    </PageLayout>
  );
}