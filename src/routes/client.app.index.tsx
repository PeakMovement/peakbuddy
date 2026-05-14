import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/client/app/")({
  component: () => <Navigate to="/client/app/checkin" />,
});
