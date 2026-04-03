/** Rust SidecarStatus 직렬화: Stopped→"stopped", Ready→"ready", Error(msg)→{"error":"msg"} */
export type SidecarStatus = "stopped" | "starting" | "ready" | "error";
