"use client";

import { useFormStatus } from "react-dom";

type ProviderOption = {
  id: string;
  name: string;
};

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-xl bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Saving..." : "Save mapping"}
    </button>
  );
}

export function ProviderMappingForm({ providers }: { providers: ProviderOption[] }) {
  return (
    <div className="space-y-6">
      <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="sourceType">
            Source type
          </label>
          <select
            id="sourceType"
            name="sourceType"
            defaultValue="appointments_csv"
            className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
          >
            <option value="appointments_csv">appointments_csv</option>
            <option value="provider_performance_csv">provider_performance_csv</option>
          </select>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="rawProviderName">
            Raw provider name
          </label>
          <input
            id="rawProviderName"
            name="rawProviderName"
            type="text"
            required
            placeholder="e.g. Dr William Huynh (Medical)"
            className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="providerId">
            Provider
          </label>
          <select
            id="providerId"
            name="providerId"
            required
            className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
          >
            <option value="">Select a provider</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="notes">
            Notes
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            placeholder="Optional note"
            className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
          />
        </div>

        <SubmitButton />
      </div>
    </div>
  );
}