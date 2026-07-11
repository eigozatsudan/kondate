import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type PropsWithChildren } from "react";

type AppProvidersProps = PropsWithChildren<{
  queryClient?: QueryClient;
}>;

function createDefaultQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

export function AppProviders({ children, queryClient }: AppProvidersProps) {
  const [ownedClient] = useState(createDefaultQueryClient);
  return <QueryClientProvider client={queryClient ?? ownedClient}>{children}</QueryClientProvider>;
}
