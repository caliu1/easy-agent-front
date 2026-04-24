import { buildApiUrl } from "@/config/api-config";
import type {
  AgentConfigDeleteRequestDTO,
  AgentConfigDetailResponseDTO,
  AgentConfigOfflineRequestDTO,
  AgentConfigPageQueryRequestDTO,
  AgentConfigPageResponseDTO,
  AgentConfigPublishRequestDTO,
  AgentConfigRollbackRequestDTO,
  AgentConfigSubscribeRequestDTO,
  AgentConfigSummaryResponseDTO,
  AgentConfigUpsertRequestDTO,
  AiAgentConfigResponseDTO,
  ApiResponse,
  ChatRequestDTO,
  ChatResponseDTO,
  ChatStreamEventResponseDTO,
  CreateSessionRequestDTO,
  CreateSessionResponseDTO,
  UserAuthResponseDTO,
  UserLoginRequestDTO,
  UserRegisterRequestDTO,
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

const LIST_QUERY_PAGE_SIZE = 200;

async function requestAgentConfigSummaryList(
  payload: AgentConfigPageQueryRequestDTO,
): Promise<ApiResponse<AgentConfigSummaryResponseDTO[]>> {
  let pageNo = 1;
  const records: AgentConfigSummaryResponseDTO[] = [];
  let pageResponse = await request<AgentConfigPageResponseDTO>(buildApiUrl("/agent_config_page_query"), {
    method: "POST",
    body: JSON.stringify({
      ...payload,
      pageNo,
      pageSize: LIST_QUERY_PAGE_SIZE,
    }),
  });

  while (true) {
    const pageData = pageResponse.data;
    const pageRecords = pageData?.records ?? [];
    records.push(...pageRecords);

    const total = pageData?.total ?? records.length;
    if (!pageData || pageRecords.length === 0 || records.length >= total) {
      return {
        code: pageResponse.code,
        info: pageResponse.info,
        data: records,
      };
    }

    pageNo += 1;
    pageResponse = await request<AgentConfigPageResponseDTO>(buildApiUrl("/agent_config_page_query"), {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        pageNo,
        pageSize: LIST_QUERY_PAGE_SIZE,
      }),
    });
  }
}

export const agentService = {
  queryAiAgentConfigList() {
    return request<AiAgentConfigResponseDTO[]>(buildApiUrl("/query_ai_agent_config_list"), {
      method: "GET",
    });
  },

  userRegister(payload: UserRegisterRequestDTO) {
    return request<UserAuthResponseDTO>(buildApiUrl("/user_register"), {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  userLogin(payload: UserLoginRequestDTO) {
    return request<UserAuthResponseDTO>(buildApiUrl("/user_login"), {
      method: "POST",
      body: JSON.stringify(payload),
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

  async queryAgentConfigList() {
    return requestAgentConfigSummaryList({});
  },

  async queryMyAgentConfigList(userId: string) {
    return requestAgentConfigSummaryList({
      ownerUserId: userId,
      sourceType: "USER",
    });
  },

  queryAgentPlazaList() {
    return request<AgentConfigSummaryResponseDTO[]>(buildApiUrl("/agent_config_plaza_list"), {
      method: "GET",
    });
  },

  queryMySubscribedAgentConfigList(userId: string) {
    return request<AgentConfigSummaryResponseDTO[]>(
      buildApiUrl(`/agent_config_my_subscribe_list?userId=${encodeURIComponent(userId)}`),
      {
        method: "GET",
      },
    );
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

  subscribeAgentConfig(payload: AgentConfigSubscribeRequestDTO) {
    return request<boolean>(buildApiUrl("/agent_config_subscribe"), {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  unsubscribeAgentConfig(payload: AgentConfigSubscribeRequestDTO) {
    return request<boolean>(buildApiUrl("/agent_config_unsubscribe"), {
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
