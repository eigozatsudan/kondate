import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { BillingPage } from "./pages/BillingPage";
import { DashboardPage } from "./pages/DashboardPage";
import { FeedbackPage } from "./pages/FeedbackPage";
import { GenerationsPage } from "./pages/GenerationsPage";
import { QuotaHealthPage } from "./pages/QuotaHealthPage";
import { ShareJobsPage } from "./pages/ShareJobsPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 15_000,
      refetchOnWindowFocus: false,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<DashboardPage />} />
            <Route path="generations" element={<GenerationsPage />} />
            <Route path="feedback" element={<FeedbackPage />} />
            <Route path="quota-health" element={<QuotaHealthPage />} />
            <Route path="billing" element={<BillingPage />} />
            <Route path="share-jobs" element={<ShareJobsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
