import { TriangleAlert } from "lucide-react";
import { isRouteErrorResponse, useRouteError } from "react-router";
import { ToriiMark } from "@/components/ToriiMark";
import { Button } from "@/components/ui/button";

// What a person sees if a page fails while drawing, in place of the router's raw error screen. It is the sign-in card's twin: the same
// card, logo and spacing, so a failure looks like part of the app.
export const RouteError = () => {
  const error = useRouteError();
  const detail = isRouteErrorResponse(error) ? `${String(error.status)} ${error.statusText}` : error instanceof Error ? error.message : "Something unexpected happened.";
  return (
    <div className="flex h-full items-center justify-center p-4">
      <div className="grid w-full max-w-sm gap-4 rounded-xl border bg-card p-6 shadow-card" role="alert">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><ToriiMark /></span>
          Torii
        </div>
        <div className="flex items-center gap-2 font-semibold">
          <TriangleAlert className="size-5 shrink-0 text-destructive" />
          This page could not be shown
        </div>
        <p className="break-words rounded-md bg-muted px-3 py-2 font-mono text-[13px] text-muted-foreground">{detail}</p>
        <p className="text-muted-foreground">If a device was just updated, reload the page: a device running an older version can be behind this one.</p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="primary" size="lg" onClick={() => {
            window.location.reload();
          }}
          >
            Reload
          </Button>
          <Button size="lg" onClick={() => {
            window.location.assign("/");
          }}
          >
            Back to start
          </Button>
        </div>
      </div>
    </div>
  );
};
