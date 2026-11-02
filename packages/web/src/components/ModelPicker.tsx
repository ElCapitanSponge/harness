import { Select } from "@/components/ui/fields";
import { useCatalogue } from "@/lib/queries";
import { clockTime } from "@/lib/time";
import type { CatalogueEntry } from "@/lib/types";

const stateLabel = (m: CatalogueEntry): string => {
  switch (m.state) {
    case "loaded":
      return "";
    case "loads-on-use":
      return " - loads when used";
    case "busy":
      return ` - busy${m.busyReason ? ` (${m.busyReason})` : ""}`;
    case "cannot-load":
      return " - cannot load here";
    case "limited":
      return ` - ${m.busyReason ?? "too big right now"}`;
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
  const groups = new Map<string, CatalogueEntry[]>();
  for (const m of data?.models ?? []) {
    groups.set(m.device, [...(groups.get(m.device) ?? []), m]);
  }
  const empty = !data || (data.models.length === 0 && !data.claude.available);
  const selected = value || "auto";

  return (
    <Select
      aria-label="Model"
      className={className}
      disabled={disabled ?? false}
      value={selected}
      onChange={(ev) => {
        onChange(ev.target.value);
      }}
    >
      <option value="auto">Auto (Torii chooses)</option>
      {empty ? <option value="" disabled>{catalogue.isPending ? "Loading models..." : "No models: connect a device"}</option> : null}
      {[...groups.entries()].map(([device, models]) => {
        return (
          <optgroup key={device} label={device}>
            {models.map((m) => {
              return <option key={`${device}/${m.id}`} value={m.id} disabled={m.state === "busy" || m.state === "cannot-load" || m.state === "limited"}>{m.id}{stateLabel(m)}</option>;
            })}
          </optgroup>
        );
      })}
      {data?.claude.available
        ? (
            <optgroup label={`Claude (through ${data.claude.device ?? "a device"})`}>
              {data.claude.models.map((id) => {
                return <option key={id} value={id}>{id}</option>;
              })}
            </optgroup>
          )
        : null}
      {data?.claude.limitedUntil !== undefined
        ? (
            <optgroup label={`Claude - limited until ${clockTime(data.claude.limitedUntil)}`}>
              {data.claude.models.map((id) => {
                return <option key={id} value={id} disabled>{id}</option>;
              })}
            </optgroup>
          )
        : null}
    </Select>
  );
};
