import type { RuntimeSession } from "./types.js";

export interface TicketIdentity {
  id: string;
  subtitle?: string;
  description?: string;
}

export function ticketIdentity(session: Pick<RuntimeSession, "context" | "workflow">): TicketIdentity | undefined {
  const workflowId = session.workflow?.ticketId?.trim();
  const contextTicket = session.context?.ticket;
  const contextId = contextTicket?.id?.trim();
  const id = workflowId || contextId;
  if (!id) return undefined;
  if (workflowId && contextId !== workflowId) return { id: workflowId };
  return {
    id,
    ...(contextTicket?.subtitle ? { subtitle: contextTicket.subtitle } : {}),
    ...(contextTicket?.description ? { description: contextTicket.description } : {}),
  };
}

export function ticketSearchText(session: Pick<RuntimeSession, "context" | "workflow">): string[] {
  const ticket = ticketIdentity(session);
  return ticket ? [ticket.id, ticket.subtitle ?? "", ticket.description ?? ""] : [];
}
