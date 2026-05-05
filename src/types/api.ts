/**
 * 前后端接口类型定义：集中维护 DTO 与响应结构。
 */

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

export interface DeleteSessionRequestDTO {
  sessionId: string;
  userId: string;
}

export interface UserRegisterRequestDTO {
  userId: string;
  password: string;
  nickname?: string;
}

export interface UserLoginRequestDTO {
  userId: string;
  password: string;
}

export interface UserAuthResponseDTO {
  userId: string;
  nickname: string;
  token: string;
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

export interface SessionHistorySummaryResponseDTO {
  sessionId: string;
  agentId: string;
  userId: string;
  sessionTitle: string;
  latestMessage: string;
  messageCount: number;
  totalTokens?: number;
  createTime?: number;
  updateTime?: number;
}

export interface SessionHistoryMessageResponseDTO {
  id?: number;
  sessionId: string;
  agentId: string;
  userId: string;
  role: string;
  content: string;
  createTime?: number;
}

export interface AgentConfigUpsertRequestDTO {
  agentId?: string;
  appName?: string;
  agentName?: string;
  agentDesc?: string;
  configJson: string;
  operator?: string;
  ownerUserId?: string;
  sourceType?: string;
  plazaStatus?: string;
  selectedMcpNames?: string[];
}

export interface AgentConfigDeleteRequestDTO {
  agentId: string;
  operator?: string;
}

export interface AgentConfigSubscribeRequestDTO {
  userId: string;
  agentId: string;
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

export interface AgentSkillImportItemDTO {
  type: string;
  path: string;
  skillName?: string;
}

export interface AgentSkillImportResponseDTO {
  bucket: string;
  prefix: string;
  fileCount: number;
  skillCount: number;
  toolSkillsList: AgentSkillImportItemDTO[];
}

export interface AgentSkillSaveEntryDTO {
  kind: "file" | "folder";
  path: string;
  content?: string;
}

export interface AgentSkillSaveRequestDTO {
  operator?: string;
  rootFolder: string;
  entries: AgentSkillSaveEntryDTO[];
}

export interface AgentSkillAssetsEntryDTO {
  kind: "file" | "folder";
  path: string;
  content?: string;
}

export interface AgentSkillAssetsResponseDTO {
  bucket: string;
  prefix: string;
  fileCount: number;
  folderCount: number;
  entries: AgentSkillAssetsEntryDTO[];
}

export interface AgentMcpProfileUpsertRequestDTO {
  id?: number;
  userId: string;
  /**
   * Preferred: complete MCP json config.
   */
  configJson?: string;
  description?: string;
  type: "sse" | "streamableHttp";
  name: string;
  baseUri?: string;
  /**
   * SSE 时表示 sseEndpoint；streamableHttp 时表示 endpoint。
   */
  sseEndpoint?: string;
  requestTimeout?: number;
  /**
   * none | bearer | apiKey
   */
  authType?: string;
  /**
   * bearer token / apiKey value
   */
  authToken?: string;
  /**
   * header key when authType=apiKey
   */
  authKeyName?: string;
  /**
   * JSON object string for headers
   */
  headersJson?: string;
  /**
   * JSON object string for query params
   */
  queryJson?: string;
}

export interface AgentMcpProfileDeleteRequestDTO {
  id: number;
  userId: string;
}

export interface AgentMcpProfileResponseDTO {
  id?: number;
  userId?: string;
  systemProvided?: boolean;
  configJson?: string;
  description?: string;
  type?: "sse" | "streamableHttp" | string;
  name: string;
  baseUri?: string;
  /**
   * SSE 时表示 sseEndpoint；streamableHttp 时表示 endpoint。
   */
  sseEndpoint?: string;
  requestTimeout?: number;
  authType?: string;
  authToken?: string;
  authKeyName?: string;
  headersJson?: string;
  queryJson?: string;
  createTime?: number;
  updateTime?: number;
}

export interface AgentSkillProfileUpsertRequestDTO {
  id?: number;
  userId: string;
  skillName: string;
  ossPath: string;
}

export interface AgentSkillProfileDeleteRequestDTO {
  id: number;
  userId: string;
}

export interface AgentSkillProfileResponseDTO {
  id: number;
  userId: string;
  systemProvided?: boolean;
  skillName: string;
  ossPath: string;
  createTime?: number;
  updateTime?: number;
}
