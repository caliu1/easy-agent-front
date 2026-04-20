import { buildApiUrl } from "@/config/api-config";
import type {
  AgentConfigDeleteRequestDTO,
  AgentConfigDetailResponseDTO,
  AgentConfigOfflineRequestDTO,
  AgentConfigPageQueryRequestDTO,
  AgentConfigPageResponseDTO,
  AgentConfigPublishRequestDTO,
  AgentConfigRollbackRequestDTO,
  AgentConfigSummaryResponseDTO,
  AgentConfigUpsertRequestDTO,
  AiAgentConfigResponseDTO,
  ApiResponse,
  ChatRequestDTO,
  ChatResponseDTO,
  ChatStreamEventResponseDTO,
  CreateSessionRequestDTO,
  CreateSessionResponseDTO,
} from "@/types/api";

async function request<T>(url: string, init?: RequestInit): Promise<ApiResponse<T>> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json() as Promise<ApiResponse<T>>;
}

export const agentService = {
  queryAiAgentConfigList() {
    return request<AiAgentConfigResponseDTO[]>(buildApiUrl("/query_ai_agent_config_list"), {
      method: "GET",
    });
  },

  createAgentConfig(payload: AgentConfigUpsertRequestDTO) {
    return request<AgentConfigDetailResponseDTO>(buildApiUrl("/agent_config_create"), {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  updateAgentConfig(payload: AgentConfigUpsertRequestDTO) {
    return request<AgentConfigDetailResponseDTO>(buildApiUrl("/agent_config_update"), {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  deleteAgentConfig(payload: AgentConfigDeleteRequestDTO) {
    return request<boolean>(buildApiUrl("/agent_config_delete"), {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  queryAgentConfigDetail(agentId: string) {
    return request<AgentConfigDetailResponseDTO>(
      buildApiUrl(`/agent_config_detail?agentId=${encodeURIComponent(agentId)}`),
      {
        method: "GET",
      },
    );
  },

  queryAgentConfigList() {
    return request<AgentConfigSummaryResponseDTO[]>(buildApiUrl("/agent_config_list"), {
      method: "GET",
    });
  },

  queryMyAgentConfigList(userId: string) {
    return request<AgentConfigSummaryResponseDTO[]>(
      buildApiUrl(`/agent_config_my_list?userId=${encodeURIComponent(userId)}`),
      {
        method: "GET",
      },
    );
  },

  queryAgentPlazaList() {
    return request<AgentConfigSummaryResponseDTO[]>(buildApiUrl("/agent_config_plaza_list"), {
      method: "GET",
    });
  },

  queryAgentConfigPage(payload: AgentConfigPageQueryRequestDTO) {
    return request<AgentConfigPageResponseDTO>(buildApiUrl("/agent_config_page_query"), {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  publishAgentConfig(payload: AgentConfigPublishRequestDTO) {
    return request<AgentConfigDetailResponseDTO>(buildApiUrl("/agent_config_publish"), {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  offlineAgentConfig(payload: AgentConfigOfflineRequestDTO) {
    return request<AgentConfigDetailResponseDTO>(buildApiUrl("/agent_config_offline"), {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  rollbackAgentConfig(payload: AgentConfigRollbackRequestDTO) {
    return request<AgentConfigDetailResponseDTO>(buildApiUrl("/agent_config_rollback"), {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  publishAgentToPlaza(payload: AgentConfigPublishRequestDTO) {
    return request<AgentConfigDetailResponseDTO>(buildApiUrl("/agent_config_plaza_publish"), {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  unpublishAgentFromPlaza(payload: AgentConfigOfflineRequestDTO) {
    return request<AgentConfigDetailResponseDTO>(buildApiUrl("/agent_config_plaza_offline"), {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  createSession(payload: CreateSessionRequestDTO) {
    return request<CreateSessionResponseDTO>(buildApiUrl("/create_session"), {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  chat(payload: ChatRequestDTO) {
    return request<ChatResponseDTO>(buildApiUrl("/chat"), {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async chatStream(
    payload: ChatRequestDTO,
    onEvent: (event: ChatStreamEventResponseDTO) => void,
    signal?: AbortSignal,
  ) {
    const response = await fetch(buildApiUrl("/chat_stream"), {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    if (!response.body) {
      throw new Error("Stream body is empty");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const dispatchEvent = async (payloadText: string) => {
      if (!payloadText || payloadText === "[DONE]") return;
      try {
        const event = JSON.parse(payloadText) as ChatStreamEventResponseDTO;
        onEvent(event);
        // Yield once so React has a chance to paint incremental updates.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      } catch (error) {
        console.warn("Failed to parse stream event", payloadText, error);
      }
    };

    const flushBlocks = async (isTail: boolean) => {
      const separator = /\r?\n\r?\n/;
      const blocks = buffer.split(separator);
      buffer = isTail ? "" : blocks.pop() ?? "";

      for (const block of blocks) {
        if (!block.trim()) continue;

        const lines = block.split(/\r?\n/);
        const dataLines: string[] = [];
        for (const line of lines) {
          const normalized = line.trim();
          if (!normalized) continue;
          if (normalized.startsWith("event:")) continue;
          if (!normalized.startsWith("data:")) continue;
          dataLines.push(normalized.slice("data:".length).trim());
        }

        const payloadText = dataLines.join("\n").trim();
        await dispatchEvent(payloadText);
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      await flushBlocks(false);
    }

    buffer += decoder.decode();
    await flushBlocks(true);
  },
};
