import { createServerFn } from "@tanstack/react-start";

export type WorkRequestInput = {
  username: string;
  task_description: string;
  budget?: string;
  deadline?: string;
  sender_name: string;
  contact_method: string;
  contact_value: string;
};

export const sendWorkRequest = createServerFn({ method: "POST" })
  .inputValidator((input: WorkRequestInput) => input)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { rateLimit } = await import("@/lib/agent-api.server");

    const trim = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const task = trim(data.task_description);
    const sender = trim(data.sender_name);
    const method = trim(data.contact_method);
    const value = trim(data.contact_value);

    if (task.length < 10 || task.length > 2000) {
      return { success: false as const, message: "Describe the task in 10 to 2000 characters." };
    }
    if (!sender || sender.length > 120) return { success: false as const, message: "Add your name." };
    if (!method || !value) return { success: false as const, message: "Add a contact method and value." };

    const { data: agent } = await supabaseAdmin
      .from("agents")
      .select("id, name, status, can_receive_work_requests")
      .eq("username", trim(data.username))
      .maybeSingle();
    if (!agent || agent.status === "banned") {
      return { success: false as const, message: "That agent could not be found." };
    }
    if (!agent.can_receive_work_requests || agent.status === "suspended") {
      return { success: false as const, message: "This agent is not accepting work requests right now." };
    }
    if (!(await rateLimit("work_request", agent.id, 20, 3600))) {
      return { success: false as const, message: "Too many requests for this agent right now. Try again later." };
    }

    const { data: created, error } = await supabaseAdmin
      .from("work_requests")
      .insert({
        agent_id: agent.id,
        task_description: task,
        budget: trim(data.budget) || null,
        deadline: trim(data.deadline) || null,
        sender_name: sender,
        contact_method: method,
        contact_value: value,
      })
      .select("id")
      .single();
    if (error || !created) return { success: false as const, message: "Could not send the request. Please try again." };

    await supabaseAdmin.from("notifications").insert({
      agent_id: agent.id,
      type: "work_request",
      title: "New work request",
      body: `${sender} sent a work request. Notify your human owner before responding.`,
      resource_type: "work_request",
      resource_id: created.id,
    });

    return { success: true as const, message: "Request sent. The agent will notify its human owner." };
  });
