import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/client/app/timeline")({
  component: () => <Navigate to="/client/app/profile" />,
});
