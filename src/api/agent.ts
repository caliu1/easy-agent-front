/**
 * 前端 Agent API 封装：统一对后端接口的请求与返回类型约束。
 */

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
  AgentMcpProfileDeleteRequestDTO,
  AgentMcpProfileResponseDTO,
  AgentMcpProfileUpsertRequestDTO,
  AgentSkillSaveRequestDTO,
  AgentSkillAssetsResponseDTO,
  AgentSkillImportResponseDTO,
  AgentSkillProfileDeleteRequestDTO,
  AgentSkillProfileResponseDTO,
  AgentSkillProfileUpsertRequestDTO,
  AiAgentConfigResponseDTO,
  ApiResponse,
  ChatRequestDTO,
  ChatResponseDTO,
  ChatStreamEventResponseDTO,
  CreateSessionRequestDTO,
  CreateSessionResponseDTO,
  DeleteSessionRequestDTO,
  SessionHistoryMessageResponseDTO,
  SessionHistorySummaryResponseDTO,
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

  async importSkillZip(file: File, operator?: string) {
    const formData = new FormData();
    formData.append("file", file);
    if (operator && operator.trim()) {
      formData.append("operator", operator.trim());
    }

    const response = await fetch(buildApiUrl("/agent_skill_import_zip"), {
      method: "POST",
      body: formData,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json() as Promise<ApiResponse<AgentSkillImportResponseDTO>>;
  },

  saveSkillAssets(payload: AgentSkillSaveRequestDTO) {
    return request<AgentSkillImportResponseDTO>(buildApiUrl("/agent_skill_save"), {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  querySkillAssets(ossPath: string) {
    return request<AgentSkillAssetsResponseDTO>(
      buildApiUrl(`/agent_skill_assets_query?ossPath=${encodeURIComponent(ossPath)}`),
      {
        method: "GET",
      },
    );
  },

  createMcpProfile(payload: AgentMcpProfileUpsertRequestDTO) {
    return request<AgentMcpProfileResponseDTO>(buildApiUrl("/agent_mcp_profile_create"), {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  updateMcpProfile(payload: AgentMcpProfileUpsertRequestDTO) {
    return request<AgentMcpProfileResponseDTO>(buildApiUrl("/agent_mcp_profile_update"), {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  deleteMcpProfile(payload: AgentMcpProfileDeleteRequestDTO) {
    return request<boolean>(buildApiUrl("/agent_mcp_profile_delete"), {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  queryMcpProfileList(userId: string) {
    return request<AgentMcpProfileResponseDTO[]>(
      buildApiUrl(`/agent_mcp_profile_list?userId=${encodeURIComponent(userId)}`),
      { method: "GET" },
    );
  },

  testMcpProfileConnection(payload: AgentMcpProfileUpsertRequestDTO) {
    return request<boolean>(buildApiUrl("/agent_mcp_profile_test"), {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  createSkillProfile(payload: AgentSkillProfileUpsertRequestDTO) {
    return request<AgentSkillProfileResponseDTO>(buildApiUrl("/agent_skill_profile_create"), {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  updateSkillProfile(payload: AgentSkillProfileUpsertRequestDTO) {
    return request<AgentSkillProfileResponseDTO>(buildApiUrl("/agent_skill_profile_update"), {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  deleteSkillProfile(payload: AgentSkillProfileDeleteRequestDTO) {
    return request<boolean>(buildApiUrl("/agent_skill_profile_delete"), {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  querySkillProfileList(userId: string) {
    return request<AgentSkillProfileResponseDTO[]>(
      buildApiUrl(`/agent_skill_profile_list?userId=${encodeURIComponent(userId)}`),
      { method: "GET" },
    );
  },

  createSession(payload: CreateSessionRequestDTO) {
    return request<CreateSessionResponseDTO>(buildApiUrl("/create_session"), {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  deleteSession(payload: DeleteSessionRequestDTO) {
    return request<boolean>(buildApiUrl("/delete_session"), {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  querySessionHistoryList(userId: string, agentId?: string) {
    const params = new URLSearchParams();
    params.set("userId", userId);
    if (agentId && agentId.trim()) {
      params.set("agentId", agentId.trim());
    }
    return request<SessionHistorySummaryResponseDTO[]>(
      buildApiUrl(`/query_session_history_list?${params.toString()}`),
      {
        method: "GET",
      },
    );
  },

  querySessionMessageList(sessionId: string) {
    return request<SessionHistoryMessageResponseDTO[]>(
      buildApiUrl(`/query_session_message_list?sessionId=${encodeURIComponent(sessionId)}`),
      {
        method: "GET",
      },
    );
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

    const dispatchEvent = (payloadText: string) => {
      if (!payloadText || payloadText === "[DONE]") return;
      try {
        const event = JSON.parse(payloadText) as ChatStreamEventResponseDTO;
        onEvent(event);
      } catch (error) {
        console.warn("Failed to parse stream event", payloadText, error);
      }
    };

    const flushBlocks = (isTail: boolean) => {
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
        dispatchEvent(payloadText);
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      flushBlocks(false);
    }

    buffer += decoder.decode();
    flushBlocks(true);
  },
};
