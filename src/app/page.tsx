import { redirect } from "next/navigation";

// The app opens straight on the login screen; there's no marketing landing.
export default function Home() {
  redirect("/login");
}
