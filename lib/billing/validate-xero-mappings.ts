export type MappingProvider = {
  id: string;
  name: string;
  xero_contact_id: string | null;
};
export type MappingResult = {
  providerId: string;
  providerName: string;
  contactId: string | null;
  status:
    | "found"
    | "missing"
    | "invalid_format"
    | "not_found"
    | "archived"
    | "unverified";
  contactName?: string;
  duplicate: boolean;
};
type XeroRead = (path: string) => Promise<{
  Contacts?: { ContactID: string; Name: string; ContactStatus: string }[];
}>;
export async function validateXeroMappings(
  providers: MappingProvider[],
  read: XeroRead,
): Promise<MappingResult[]> {
  const ids = providers
    .map((p) => p.xero_contact_id?.trim().toLowerCase())
    .filter(Boolean);
  const cache = new Map<
    string,
    Pick<MappingResult, "status" | "contactName">
  >();
  const results: MappingResult[] = [];
  for (const provider of providers) {
    const contactId = provider.xero_contact_id?.trim() || null;
    const key = contactId?.toLowerCase() || "";
    const result: MappingResult = {
      providerId: provider.id,
      providerName: provider.name,
      contactId,
      status: "missing",
      duplicate: !!key && ids.filter((id) => id === key).length > 1,
    };
    if (contactId) {
      if (
        !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
          contactId,
        )
      )
        result.status = "invalid_format";
      else {
        let checked = cache.get(key);
        if (!checked) {
          try {
            const response = await read(
              `/Contacts/${encodeURIComponent(contactId)}`,
            );
            const contact = response.Contacts?.find(
              (c) => c.ContactID.toLowerCase() === key,
            );
            checked = contact
              ? {
                  status:
                    contact.ContactStatus === "ACTIVE"
                      ? "found"
                      : contact.ContactStatus === "ARCHIVED"
                        ? "archived"
                        : "unverified",
                  contactName: contact.Name,
                }
              : { status: "not_found" };
          } catch (error) {
            checked = {
              status:
                error instanceof Error &&
                /^Xero request failed: 404\b/.test(error.message)
                  ? "not_found"
                  : "unverified",
            };
          }
          cache.set(key, checked);
        }
        Object.assign(result, checked);
      }
    }
    results.push(result);
  }
  return results;
}
