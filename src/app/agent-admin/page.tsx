"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2, RefreshCw, Save, Search, Trash2, UploadCloud } from "lucide-react";
import { agentService } from "@/api/agent";
import { cookieUtils } from "@/utils/cookie";
import type {
  AgentConfigDetailResponseDTO,
  AgentConfigPageQueryRequestDTO,
  AgentConfigSummaryResponseDTO,
  AgentConfigUpsertRequestDTO,
} from "@/types/api";

const SUCCESS_CODE = "0000";
const DEFAULT_PAGE_SIZE = 10;

type Notice = {
  type: "success" | "error" | "info";
  text: string;
};

const EMPTY_FORM: AgentConfigUpsertRequestDTO = {
  agentId: "",
  appName: "",
  agentName: "",
  agentDesc: "",
  configJson: "",
  operator: "",
};

function AgentAdminPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preferredAgentId = searchParams.get("agentId")?.trim() ?? "";

  const [userId, setUserId] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);

  const [filters, setFilters] = useState<AgentConfigPageQueryRequestDTO>({
    pageNo: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    agentId: "",
    appName: "",
    agentName: "",
    status: "",
    operator: "",
  });

  const [listLoading, setListLoading] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [records, setRecords] = useState<AgentConfigSummaryResponseDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedAgentId, setSelectedAgentId] = useState("");

  const [form, setForm] = useState<AgentConfigUpsertRequestDTO>(EMPTY_FORM);
  const [detail, setDetail] = useState<AgentConfigDetailResponseDTO | null>(null);

  const pageNo = filters.pageNo ?? 1;
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const isEditMode = Boolean(detail && detail.agentId === form.agentId);

  const showNotice = useCallback((type: Notice["type"], text: string) => {
    setNotice({ type, text });
  }, []);

  const buildOperator = useCallback(
    (fallback = "") => {
      const explicit = (form.operator ?? "").trim();
      if (explicit) return explicit;
      if (userId.trim()) return userId.trim();
      return fallback;
    },
    [form.operator, userId],
  );

  const loadPage = useCallback(
    async (patch?: Partial<AgentConfigPageQueryRequestDTO>) => {
      const payload: AgentConfigPageQueryRequestDTO = {
        ...filters,
        ...patch,
      };

      setListLoading(true);
      try {
        const response = await agentService.queryAgentConfigPage(payload);
        if (response.code !== SUCCESS_CODE || !response.data) {
          throw new Error(response.info || "Failed to query agent configs");
        }

        setRecords(response.data.records ?? []);
        setTotal(response.data.total ?? 0);
        setFilters((prev) => ({
          ...prev,
          ...patch,
          pageNo: response.data.pageNo ?? payload.pageNo ?? 1,
          pageSize: response.data.pageSize ?? payload.pageSize ?? DEFAULT_PAGE_SIZE,
        }));
      } catch (error) {
        console.error(error);
        showNotice("error", error instanceof Error ? error.message : "Failed to query agent configs");
      } finally {
        setListLoading(false);
      }
    },
    [filters, showNotice],
  );

  const loadDetail = useCallback(
    async (agentId: string, silent = false) => {
      if (!agentId.trim()) return;
      setFormLoading(true);
      try {
        const response = await agentService.queryAgentConfigDetail(agentId);
        if (response.code !== SUCCESS_CODE || !response.data) {
          throw new Error(response.info || "Failed to query detail");
        }
        const data = response.data;
        setSelectedAgentId(data.agentId);
        setDetail(data);
        setForm({
          agentId: data.agentId,
          appName: data.appName ?? "",
          agentName: data.agentName ?? "",
          agentDesc: data.agentDesc ?? "",
          configJson: data.configJson ?? "",
          operator: data.operator ?? userId,
        });
        if (!silent) {
          showNotice("success", `Loaded detail: ${data.agentId}`);
        }
      } catch (error) {
        console.error(error);
        showNotice("error", error instanceof Error ? error.message : "Failed to query detail");
      } finally {
        setFormLoading(false);
      }
    },
    [showNotice, userId],
  );

  const refreshAfterMutation = useCallback(
    async (targetAgentId?: string) => {
      await loadPage();
      if (targetAgentId?.trim()) {
        await loadDetail(targetAgentId, true);
      }
    },
    [loadDetail, loadPage],
  );

  const parseAndNormalizeConfigJson = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) throw new Error("configJson is required");
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return JSON.stringify(parsed, null, 2);
    } catch {
      throw new Error("configJson must be a valid JSON string");
    }
  };

  const handleCreate = async () => {
    const agentId = form.agentId.trim();
    if (!agentId) {
      showNotice("error", "agentId is required");
      return;
    }

    setSubmitLoading(true);
    try {
      const configJson = parseAndNormalizeConfigJson(form.configJson);
      const response = await agentService.createAgentConfig({
        agentId,
        appName: form.appName?.trim(),
        agentName: form.agentName?.trim(),
        agentDesc: form.agentDesc?.trim(),
        configJson,
        operator: buildOperator("admin"),
      });
      if (response.code !== SUCCESS_CODE || !response.data) {
        throw new Error(response.info || "Create failed");
      }
      showNotice("success", `Created: ${response.data.agentId}`);
      await refreshAfterMutation(response.data.agentId);
    } catch (error) {
      console.error(error);
      showNotice("error", error instanceof Error ? error.message : "Create failed");
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleUpdate = async () => {
    const agentId = form.agentId.trim();
    if (!agentId) {
      showNotice("error", "agentId is required");
      return;
    }

    setSubmitLoading(true);
    try {
      const configJson = parseAndNormalizeConfigJson(form.configJson);
      const response = await agentService.updateAgentConfig({
        agentId,
        appName: form.appName?.trim(),
        agentName: form.agentName?.trim(),
        agentDesc: form.agentDesc?.trim(),
        configJson,
        operator: buildOperator("admin"),
      });
      if (response.code !== SUCCESS_CODE || !response.data) {
        throw new Error(response.info || "Update failed");
      }
      showNotice("success", `Updated: ${response.data.agentId}`);
      await refreshAfterMutation(response.data.agentId);
    } catch (error) {
      console.error(error);
      showNotice("error", error instanceof Error ? error.message : "Update failed");
    } finally {
      setSubmitLoading(false);
    }
  };

  const handlePublish = async (agentId: string) => {
    setSubmitLoading(true);
    try {
      const response = await agentService.publishAgentConfig({
        agentId,
        operator: buildOperator("admin"),
      });
      if (response.code !== SUCCESS_CODE || !response.data) {
        throw new Error(response.info || "Publish failed");
      }
      showNotice("success", `Published: ${agentId}`);
      await refreshAfterMutation(agentId);
    } catch (error) {
      console.error(error);
      showNotice("error", error instanceof Error ? error.message : "Publish failed");
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleOffline = async (agentId: string) => {
    setSubmitLoading(true);
    try {
      const response = await agentService.offlineAgentConfig({
        agentId,
        operator: buildOperator("admin"),
      });
      if (response.code !== SUCCESS_CODE || !response.data) {
        throw new Error(response.info || "Offline failed");
      }
      showNotice("success", `Offline success: ${agentId}`);
      await refreshAfterMutation(agentId);
    } catch (error) {
      console.error(error);
      showNotice("error", error instanceof Error ? error.message : "Offline failed");
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleRollback = async (agentId: string) => {
    const raw = window.prompt("Rollback target version (integer > 0)", "1");
    if (!raw) return;
    const targetVersion = Number(raw);
    if (!Number.isInteger(targetVersion) || targetVersion <= 0) {
      showNotice("error", "Invalid targetVersion");
      return;
    }

    setSubmitLoading(true);
    try {
      const response = await agentService.rollbackAgentConfig({
        agentId,
        targetVersion,
        operator: buildOperator("admin"),
      });
      if (response.code !== SUCCESS_CODE || !response.data) {
        throw new Error(response.info || "Rollback failed");
      }
      showNotice("success", `Rollback success: ${agentId} -> ${targetVersion}`);
      await refreshAfterMutation(agentId);
    } catch (error) {
      console.error(error);
      showNotice("error", error instanceof Error ? error.message : "Rollback failed");
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleDelete = async (agentId: string) => {
    if (!window.confirm(`Delete agent config ${agentId}?`)) return;
    setSubmitLoading(true);
    try {
      const response = await agentService.deleteAgentConfig({
        agentId,
        operator: buildOperator("admin"),
      });
      if (response.code !== SUCCESS_CODE) {
        throw new Error(response.info || "Delete failed");
      }
      showNotice("success", `Deleted: ${agentId}`);
      if (selectedAgentId === agentId) {
        setSelectedAgentId("");
        setDetail(null);
        setForm({
          ...EMPTY_FORM,
          operator: userId,
        });
      }
      await loadPage();
    } catch (error) {
      console.error(error);
      showNotice("error", error instanceof Error ? error.message : "Delete failed");
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleFormatConfigJson = () => {
    try {
      const normalized = parseAndNormalizeConfigJson(form.configJson);
      setForm((prev) => ({ ...prev, configJson: normalized }));
      showNotice("success", "configJson formatted");
    } catch (error) {
      showNotice("error", error instanceof Error ? error.message : "Invalid configJson");
    }
  };

  const handleResetForm = () => {
    setDetail(null);
    setSelectedAgentId("");
    setForm({
      ...EMPTY_FORM,
      operator: userId,
    });
    showNotice("info", "Switched to create mode");
  };

  const statusBadgeClass = useMemo(
    () => ({
      PUBLISHED: "bg-emerald-100 text-emerald-700",
      OFFLINE: "bg-zinc-200 text-zinc-700",
      DRAFT: "bg-amber-100 text-amber-700",
    }),
    [],
  );

  useEffect(() => {
    const session = cookieUtils.getSession();
    if (session.isLoggedIn !== "true" || !session.username) {
      router.replace("/login");
      return;
    }

    const uid = session.username;
    setUserId(uid);
    setForm((prev) => ({ ...prev, operator: prev.operator || uid }));

    const init = async () => {
      if (preferredAgentId) {
        await loadPage({
          pageNo: 1,
          agentId: preferredAgentId,
        });
        await loadDetail(preferredAgentId, true);
        return;
      }
      await loadPage();
    };

    void init();
  }, [loadDetail, loadPage, preferredAgentId, router]);

  return (
    <div className="min-h-screen bg-zinc-50 p-6 text-zinc-900">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
          <div>
            <h1 className="text-xl font-semibold">Agent Config Admin</h1>
            <p className="text-sm text-zinc-500">Manage dynamic agent configuration with CRUD and lifecycle operations.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.push("/")}
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100"
            >
              <ArrowLeft size={14} />
              Back
            </button>
            <button
              type="button"
              onClick={() => void loadPage()}
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100"
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          </div>
        </div>

        {notice ? (
          <div
            className={`rounded-lg border px-4 py-2 text-sm ${
              notice.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : notice.type === "error"
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : "border-blue-200 bg-blue-50 text-blue-700"
            }`}
          >
            {notice.text}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm lg:col-span-7">
            <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              <input
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                placeholder="agentId"
                value={filters.agentId ?? ""}
                onChange={(event) =>
                  setFilters((prev) => ({
                    ...prev,
                    agentId: event.target.value,
                  }))
                }
              />
              <input
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                placeholder="appName"
                value={filters.appName ?? ""}
                onChange={(event) =>
                  setFilters((prev) => ({
                    ...prev,
                    appName: event.target.value,
                  }))
                }
              />
              <input
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                placeholder="agentName"
                value={filters.agentName ?? ""}
                onChange={(event) =>
                  setFilters((prev) => ({
                    ...prev,
                    agentName: event.target.value,
                  }))
                }
              />
              <select
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                value={filters.status ?? ""}
                onChange={(event) =>
                  setFilters((prev) => ({
                    ...prev,
                    status: event.target.value,
                  }))
                }
              >
                <option value="">Status: ALL</option>
                <option value="DRAFT">DRAFT</option>
                <option value="PUBLISHED">PUBLISHED</option>
                <option value="OFFLINE">OFFLINE</option>
              </select>
              <input
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                placeholder="operator"
                value={filters.operator ?? ""}
                onChange={(event) =>
                  setFilters((prev) => ({
                    ...prev,
                    operator: event.target.value,
                  }))
                }
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void loadPage({ pageNo: 1 })}
                  className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
                >
                  <Search size={14} />
                  Search
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFilters((prev) => ({
                      ...prev,
                      pageNo: 1,
                      pageSize: DEFAULT_PAGE_SIZE,
                      agentId: "",
                      appName: "",
                      agentName: "",
                      status: "",
                      operator: "",
                    }));
                    void loadPage({
                      pageNo: 1,
                      pageSize: DEFAULT_PAGE_SIZE,
                      agentId: "",
                      appName: "",
                      agentName: "",
                      status: "",
                      operator: "",
                    });
                  }}
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100"
                >
                  Reset
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-zinc-200">
              <div className="grid grid-cols-[1.2fr_1fr_1fr_0.8fr_0.8fr_1.2fr] gap-2 border-b border-zinc-200 bg-zinc-100 px-3 py-2 text-xs font-medium uppercase text-zinc-600">
                <span>Agent</span>
                <span>App</span>
                <span>Name</span>
                <span>Status</span>
                <span>Version</span>
                <span>Actions</span>
              </div>

              <div className="max-h-[28rem] overflow-auto">
                {listLoading ? (
                  <div className="flex items-center justify-center p-6 text-sm text-zinc-500">
                    <Loader2 size={16} className="mr-2 animate-spin" />
                    Loading...
                  </div>
                ) : records.length === 0 ? (
                  <div className="p-6 text-center text-sm text-zinc-500">No data</div>
                ) : (
                  records.map((record) => {
                    const statusClass =
                      statusBadgeClass[record.status as keyof typeof statusBadgeClass] ?? "bg-zinc-100 text-zinc-700";
                    return (
                      <div
                        key={record.agentId}
                        className={`grid grid-cols-[1.2fr_1fr_1fr_0.8fr_0.8fr_1.2fr] gap-2 border-b border-zinc-100 px-3 py-3 text-sm ${
                          selectedAgentId === record.agentId ? "bg-blue-50" : "bg-white"
                        }`}
                      >
                        <button
                          type="button"
                          className="truncate text-left font-medium text-blue-700 hover:underline"
                          onClick={() => void loadDetail(record.agentId)}
                        >
                          {record.agentId}
                        </button>
                        <span className="truncate">{record.appName}</span>
                        <span className="truncate">{record.agentName}</span>
                        <span>
                          <span className={`rounded-md px-2 py-1 text-xs font-medium ${statusClass}`}>{record.status}</span>
                        </span>
                        <span>{record.currentVersion ?? "-"}</span>
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            className="rounded border border-zinc-300 px-1.5 py-1 text-xs hover:bg-zinc-100"
                            onClick={() => void handlePublish(record.agentId)}
                            disabled={submitLoading}
                          >
                            Publish
                          </button>
                          <button
                            type="button"
                            className="rounded border border-zinc-300 px-1.5 py-1 text-xs hover:bg-zinc-100"
                            onClick={() => void handleOffline(record.agentId)}
                            disabled={submitLoading}
                          >
                            Offline
                          </button>
                          <button
                            type="button"
                            className="rounded border border-zinc-300 px-1.5 py-1 text-xs hover:bg-zinc-100"
                            onClick={() => void handleRollback(record.agentId)}
                            disabled={submitLoading}
                          >
                            Rollback
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded border border-rose-300 px-1.5 py-1 text-xs text-rose-700 hover:bg-rose-50"
                            onClick={() => void handleDelete(record.agentId)}
                            disabled={submitLoading}
                          >
                            <Trash2 size={12} />
                            Delete
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between text-sm text-zinc-600">
              <span>
                Total: <strong>{total}</strong>
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-50"
                  disabled={pageNo <= 1 || listLoading}
                  onClick={() => void loadPage({ pageNo: Math.max(1, pageNo - 1) })}
                >
                  Prev
                </button>
                <span>
                  {pageNo}/{totalPages}
                </span>
                <button
                  type="button"
                  className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-50"
                  disabled={pageNo >= totalPages || listLoading}
                  onClick={() => void loadPage({ pageNo: Math.min(totalPages, pageNo + 1) })}
                >
                  Next
                </button>
                <select
                  className="rounded border border-zinc-300 px-2 py-1"
                  value={pageSize}
                  onChange={(event) => {
                    const nextSize = Number(event.target.value);
                    void loadPage({ pageNo: 1, pageSize: nextSize });
                  }}
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm lg:col-span-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{isEditMode ? "Edit Agent Config" : "Create Agent Config"}</h2>
              <button
                type="button"
                onClick={handleResetForm}
                className="rounded-lg border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100"
              >
                New
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-700">agentId *</label>
                <input
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                  value={form.agentId}
                  onChange={(event) => setForm((prev) => ({ ...prev, agentId: event.target.value }))}
                  placeholder="e.g. 100901"
                  disabled={isEditMode}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-700">appName</label>
                  <input
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                    value={form.appName ?? ""}
                    onChange={(event) => setForm((prev) => ({ ...prev, appName: event.target.value }))}
                    placeholder="e.g. SupervisorDemoApp"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-700">agentName</label>
                  <input
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                    value={form.agentName ?? ""}
                    onChange={(event) => setForm((prev) => ({ ...prev, agentName: event.target.value }))}
                    placeholder="display name"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-700">agentDesc</label>
                <input
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                  value={form.agentDesc ?? ""}
                  onChange={(event) => setForm((prev) => ({ ...prev, agentDesc: event.target.value }))}
                  placeholder="description"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-700">operator</label>
                <input
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                  value={form.operator ?? ""}
                  onChange={(event) => setForm((prev) => ({ ...prev, operator: event.target.value }))}
                  placeholder={userId || "admin"}
                />
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="block text-sm font-medium text-zinc-700">configJson *</label>
                  <button
                    type="button"
                    onClick={handleFormatConfigJson}
                    className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100"
                  >
                    Format JSON
                  </button>
                </div>
                <textarea
                  className="h-72 w-full rounded-lg border border-zinc-300 px-3 py-2 font-mono text-xs"
                  value={form.configJson}
                  onChange={(event) => setForm((prev) => ({ ...prev, configJson: event.target.value }))}
                  placeholder='{"appName":"...","agent":{"agentId":"..."},"module":{...}}'
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  disabled={submitLoading}
                  className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {submitLoading ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />}
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => void handleUpdate()}
                  disabled={submitLoading || !isEditMode}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {submitLoading ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Update
                </button>
              </div>

              {formLoading ? (
                <div className="inline-flex items-center text-sm text-zinc-500">
                  <Loader2 size={14} className="mr-1 animate-spin" />
                  Loading detail...
                </div>
              ) : detail ? (
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
                  <div>status: {detail.status}</div>
                  <div>currentVersion: {detail.currentVersion}</div>
                  <div>publishedVersion: {detail.publishedVersion ?? "-"}</div>
                  <div>updateTime: {detail.updateTime ?? "-"}</div>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function AgentAdminPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-zinc-50 text-zinc-500">
          <Loader2 size={18} className="mr-2 animate-spin" />
          Loading...
        </div>
      }
    >
      <AgentAdminPageContent />
    </Suspense>
  );
}
