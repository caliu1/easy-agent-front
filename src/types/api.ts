export interface ApiResponse<T> {
  code: string;
  info: string;
  data: T;
}

export interface AiAgentConfigResponseDTO {
  agentId: string;
  agentName: string;
  agentDesc: string;
}

export interface CreateSessionRequestDTO {
  agentId: string;
  userId: string;
}

export interface CreateSessionResponseDTO {
  sessionId: string;
}

export interface ChatRequestDTO {
  agentId: string;
  userId: string;
  sessionId?: string;
  message: string;
}

export interface ChatResponseDTO {
  type?: "user" | "drawio" | string;
  content: string;
}

export interface ChatStreamEventResponseDTO {
  /**
   * thinking | route | reply | final | error
   */
  type: string;
  agentName?: string;
  content?: string;
  routeTarget?: string;
  partial?: boolean;
  finalResponse?: boolean;
}

export interface AgentConfigUpsertRequestDTO {
  agentId: string;
  appName?: string;
  agentName?: string;
  agentDesc?: string;
  configJson: string;
  operator?: string;
  ownerUserId?: string;
  sourceType?: string;
  plazaStatus?: string;
}

export interface AgentConfigDeleteRequestDTO {
  agentId: string;
  operator?: string;
}

export interface AgentConfigPublishRequestDTO {
  agentId: string;
  operator?: string;
}

export interface AgentConfigOfflineRequestDTO {
  agentId: string;
  operator?: string;
}

export interface AgentConfigRollbackRequestDTO {
  agentId: string;
  targetVersion: number;
  operator?: string;
}

export interface AgentConfigDetailResponseDTO {
  agentId: string;
  appName: string;
  agentName: string;
  agentDesc: string;
  configJson: string;
  status: string;
  currentVersion: number;
  publishedVersion?: number;
  operator?: string;
  ownerUserId?: string;
  sourceType?: string;
  plazaStatus?: string;
  plazaPublishTime?: number;
  createTime?: number;
  updateTime?: number;
}

export interface AgentConfigSummaryResponseDTO {
  agentId: string;
  appName: string;
  agentName: string;
  agentDesc: string;
  status: string;
  currentVersion: number;
  publishedVersion?: number;
  ownerUserId?: string;
  sourceType?: string;
  plazaStatus?: string;
  plazaPublishTime?: number;
  updateTime?: number;
}

export interface AgentConfigPageQueryRequestDTO {
  agentId?: string;
  appName?: string;
  agentName?: string;
  status?: string;
  operator?: string;
  ownerUserId?: string;
  sourceType?: string;
  plazaStatus?: string;
  pageNo?: number;
  pageSize?: number;
}

export interface AgentConfigPageResponseDTO {
  pageNo: number;
  pageSize: number;
  total: number;
  records: AgentConfigSummaryResponseDTO[];
}
