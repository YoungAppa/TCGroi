import { redirect } from "next/navigation";

/**
 * The collection tracker is parked until accounts exist — a browser-local
 * collection quietly vanishing when someone switches devices is a worse
 * experience than the feature not being there. The page and its APIs live in
 * git history; restore them when sign-in ships.
 */
export default function CollectionPage() {
  redirect("/");
}
