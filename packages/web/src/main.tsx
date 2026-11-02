import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Navigate, createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import "./index.css";
import { ApiError, setKey } from "@/lib/api";
import { startTheme } from "@/lib/theme";
import { ConversationView } from "@/views/ConversationView";
import { DevicesView } from "@/views/DevicesView";
import { Layout } from "@/views/Layout";
import { NewConversation } from "@/views/NewConversation";
import { ImportView } from "@/views/ImportView";
import { RouteError } from "@/views/RouteError";
import { PermissionsView } from "@/views/PermissionsView";
import { SkillsView } from "@/views/SkillsView";

// A rejected key sends the person back to the sign-in form.
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) {
        setKey("");
      }
    },
  }),
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true } },
});

// Addresses from the first page, #/c/<id>, become /c/<id>.
const legacy = /^#\/c\/([0-9a-f-]{36})$/.exec(window.location.hash);
if (legacy) {
  window.history.replaceState(null, "", `/c/${legacy[1] ?? ""}`);
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <NewConversation /> },
      { path: "c/:id", element: <ConversationView /> },
      { path: "manage/devices", element: <DevicesView /> },
      { path: "manage/skills", element: <SkillsView /> },
      { path: "manage/permissions", element: <PermissionsView /> },
      { path: "import", element: <ImportView /> },
      // The chart library is only fetched when the page is opened.
      { path: "manage/usage", lazy: async () => {
        return { Component: (await import("@/views/UsageView")).UsageView };
      } },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

startTheme();

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
}
