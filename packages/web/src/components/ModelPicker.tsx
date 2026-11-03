import { Choice, type ChoiceGroup } from "@/components/ui/choice";
import { useCatalogue } from "@/lib/queries";
import { clockTime } from "@/lib/time";
import type { CatalogueEntry } from "@/lib/types";

// The second line of a model in the list: whether it is ready, and if it cannot be chosen, why.
const stateDetail = (m: CatalogueEntry): string => {
  switch (m.state) {
    case "loaded":
      return "Loaded";
    case "loads-on-use":
      return "Loads when used";
    case "busy":
      return `Busy${m.busyReason ? ` (${m.busyReason})` : ""}`;
    case "cannot-load":
      return "Cannot load here";
    case "limited":
      return m.busyReason ?? "Too big right now";
  }
};

// The model that will answer. Choosing one that is not loaded loads it on that device when the first message is sent.
export const useModels = () => {
  const catalogue = useCatalogue();
  const local = (catalogue.data?.models ?? []).filter((m) => {
    return m.state === "loaded" || m.state === "loads-on-use";
  });
  const claude = catalogue.data?.claude.available ? catalogue.data.claude.models : [];
  return { catalogue, firstUsable: local[0]?.id ?? claude[0] ?? "" };
};

export const ModelPicker = ({ value, onChange, disabled, className }: { value: string; onChange: (id: string) => void; disabled?: boolean; className?: string }) => {
  const { catalogue } = useModels();
  const data = catalogue.data;
  const byDevice = new Map<string, CatalogueEntry[]>();
  for (const m of data?.models ?? []) {
    byDevice.set(m.device, [...(byDevice.get(m.device) ?? []), m]);
  }
  const empty = !data || (data.models.length === 0 && !data.claude.available);
  const selected = value || "auto";

  const groups: ChoiceGroup[] = [{ options: [{ value: "auto", label: "Auto (Torii chooses)", detail: "The gateway picks a model for each message" }] }];
  if (empty) {
    groups.push({ options: [{ value: "none", label: catalogue.isPending ? "Loading models..." : "No models: connect a device", disabled: true }] });
  }
  for (const [device, models] of byDevice) {
    groups.push({
      label: device,
      options: models.map((m) => {
        return { value: m.id, label: m.id, detail: stateDetail(m), disabled: m.state === "busy" || m.state === "cannot-load" || m.state === "limited" };
      }),
    });
  }
  if (data?.claude.available) {
    groups.push({
      label: `Claude (through ${data.claude.device ?? "a device"})${data.claude.model ? `, using ${data.claude.model}` : ""}`,
      options: data.claude.models.map((id) => {
        return { value: id, label: id };
      }),
    });
  }
  if (data?.claude.limitedUntil !== undefined) {
    const until = clockTime(data.claude.limitedUntil);
    groups.push({
      label: `Claude - limited until ${until}`,
      options: data.claude.models.map((id) => {
        return { value: id, label: id, detail: `Limited until ${until}`, disabled: true };
      }),
    });
  }
  // A model that is set but not in the list (the list is still loading, or the model went away) is shown as it is, not as Auto.
  const known = groups.some((g) => {
    return g.options.some((o) => {
      return o.value === selected;
    });
  });
  if (!known) {
    groups[0]?.options.push({ value: selected, label: selected, detail: "Not in the list right now", disabled: true });
  }

  return <Choice label="Model" className={className} disabled={disabled ?? false} value={selected} groups={groups} onValueChange={onChange} />;
};
