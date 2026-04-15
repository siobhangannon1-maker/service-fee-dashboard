import { createClient } from "@/lib/supabase/client";

export async function fetchStoredLogoDataUrl(): Promise<string | null> {
  try {
    const supabase = createClient();

    const { data, error } = await supabase.storage
      .from("branding")
      .download("logo.png");

    if (error || !data) return null;

    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(data);
    });
  } catch {
    return null;
  }
}