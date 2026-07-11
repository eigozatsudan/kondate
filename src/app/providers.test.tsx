import { useQueryClient } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { AppProviders } from "./providers";

function Probe() {
  const client = useQueryClient();
  const staleTime = client.getDefaultOptions().queries?.staleTime;

  if (typeof staleTime !== "number") {
    throw new Error("Expected a numeric default query stale time");
  }

  return <output>{staleTime}</output>;
}

it("provides the configured query client", () => {
  render(
    <AppProviders>
      <Probe />
    </AppProviders>,
  );
  expect(screen.getByText("30000")).toBeInTheDocument();
});
